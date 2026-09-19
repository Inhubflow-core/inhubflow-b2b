import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { recordSdrAuditEvent } from "@/lib/audit";
import { unipile } from "@/lib/unipile/client";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import { ensureLinkedInTargetAccountState, markLinkedInTargetState } from "@/lib/linkedin/account-state";
import { sendEmail } from "@/lib/email/sender";
import { decryptSecret } from "@/lib/crypto";
import { getSdrThread } from "./repository";
import { evaluatePreSendGuardrails } from "./guardrails/pre-send";
import { circuitClosed } from "./runtime";

export interface DispatchSdrActionOptions {
  actionId: string;
  actorUserId: string;
  workspaceOwnerId: string;
  editedBody?: string;
}

export interface DispatchSdrActionResult {
  success: boolean;
  actionId: string;
  threadId: string;
  channel: "linkedin" | "email";
  deliveryStatus: "delivered" | "failed";
  error?: string;
  messageId?: string;
}

interface SdrActionRow {
  id: string;
  workspace_owner_id: string | null;
  decision_id: string;
  thread_id: string;
  message_id: string | null;
  action_type: string;
  state: string;
  control_epoch: number;
  payload_json: string;
  edited_payload_json: string | null;
  created_at: string;
}

export async function dispatchApprovedSdrAction(
  db: Database.Database,
  options: DispatchSdrActionOptions,
): Promise<DispatchSdrActionResult> {
  const action = db.prepare(`
    SELECT * FROM sdr_actions WHERE id = ?
  `).get(options.actionId) as SdrActionRow | undefined;

  if (!action) {
    throw new Error(`SDR Action ${options.actionId} not found`);
  }

  // Idempotency / state check: only allow actions awaiting approval
  if (action.state !== "proposed" && action.state !== "waiting_approval") {
    throw new Error(`La acción ${options.actionId} ya fue procesada o no es válida (estado actual: ${action.state}).`);
  }

  const thread = getSdrThread(db, action.thread_id);
  if (!thread) {
    throw new Error(`SDR Thread ${action.thread_id} not found`);
  }

  // Fail-closed epoch check: ensure no human takeover happened concurrently
  if (thread.control_epoch !== action.control_epoch) {
    throw new Error("El hilo de conversación fue modificado o tomado por un humano (control epoch desalineado).");
  }

  if (["DO_NOT_CONTACT", "RESOLVED"].includes(thread.state)) {
    throw new Error(`No se puede enviar mensajes en un hilo con estado ${thread.state}.`);
  }

  const target = db.prepare(`
    SELECT id, full_name, linkedin_url, messaging_urn, unipile_provider_id, unipile_chat_id, email, company_id, last_replied_account_id, do_not_contact
    FROM targets WHERE id = ?
  `).get(thread.target_id) as {
    id: string;
    full_name: string | null;
    linkedin_url: string | null;
    messaging_urn: string | null;
    unipile_provider_id?: string | null;
    unipile_chat_id?: string | null;
    email: string | null;
    company_id: string | null;
    last_replied_account_id?: string | null;
    do_not_contact?: number | null;
  } | undefined;

  if (!target) {
    throw new Error(`Target ${thread.target_id} not found`);
  }

  if (target.do_not_contact) {
    throw new Error("El prospecto está marcado como 'No contactar' (Do Not Contact).");
  }

  // Parse effective payload
  const effectivePayload = action.edited_payload_json
    ? JSON.parse(action.edited_payload_json)
    : JSON.parse(action.payload_json);

  const textToSend = options.editedBody || effectivePayload.suggested_reply || effectivePayload.body || "";
  const channel = thread.channel;

  // Check if there is a newer inbound message
  const newerInbound = db.prepare(`
    SELECT id FROM sdr_messages
    WHERE thread_id = ? AND direction = 'inbound' AND sent_at > ?
    LIMIT 1
  `).get(thread.id, action.created_at);

  const agentRow = db.prepare(`
    SELECT outbound_enabled FROM sdr_agents WHERE id = ?
  `).get(thread.agent_id || "") as { outbound_enabled: number } | undefined;

  const globalOutbound = process.env.SDR_OUTBOUND_ENABLED !== "false" && process.env.SDR_OUTBOUND_ENABLED !== "0";
  const channelOutbound = channel === "linkedin"
    ? (process.env.SDR_LINKEDIN_OUTBOUND_ENABLED !== "false" && process.env.SDR_LINKEDIN_OUTBOUND_ENABLED !== "0")
    : (process.env.SDR_EMAIL_OUTBOUND_ENABLED !== "false" && process.env.SDR_EMAIL_OUTBOUND_ENABLED !== "0");

  // Pre-Send Guardrails evaluation
  const preSend = evaluatePreSendGuardrails({
    expectedControlEpoch: action.control_epoch,
    currentControlEpoch: thread.control_epoch,
    threadState: thread.state,
    effectiveMode: "approval",
    actionWasApproved: true,
    agentOutboundEnabled: agentRow ? agentRow.outbound_enabled === 1 : true,
    accountOutboundEnabled: true,
    globalOutboundEnabled: globalOutbound,
    channelOutboundEnabled: channelOutbound,
    targetDoNotContact: Boolean(target.do_not_contact),
    hasNewerInbound: Boolean(newerInbound),
    quotaAvailable: true,
    circuitClosed: circuitClosed(db, thread.workspace_owner_id, thread.agent_id || "", "outbound"),
    body: textToSend,
  });

  if (preSend.outcome === "block") {
    db.prepare(`
      UPDATE sdr_actions
      SET state = 'failed', delivery_status = 'failed',
        rejection_reason = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(`Blocked by pre-send guardrails: ${preSend.reasons.join(", ")}`, action.id);
    throw new Error(`Guardrails de pre-envío bloquearon el mensaje: ${preSend.reasons.join(", ")}`);
  }

  let externalMessageId = `sdr-msg-${Date.now()}`;
  let externalThreadId = thread.external_thread_id || target.unipile_chat_id || `thread-${target.id}`;

  // Log in sdr_outbox as sending
  const outboxId = randomUUID();
  const idempotencyKey = `sdr_outbox:${action.id}:${Date.now()}`;
  try {
    db.prepare(`
      INSERT INTO sdr_outbox (
        id, workspace_owner_id, action_id, thread_id, channel, state,
        control_epoch, recipient_snapshot, body, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'sending', ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      outboxId,
      thread.workspace_owner_id,
      action.id,
      thread.id,
      channel,
      thread.control_epoch,
      channel === "linkedin" ? (target.linkedin_url || target.id) : (target.email || target.id),
      textToSend,
      idempotencyKey,
    );
  } catch {
    // Non-blocking outbox insertion fallback
  }

  if (channel === "linkedin") {
    // 1. Resolve LinkedIn Account
    const accountId = thread.linkedin_account_id || target.last_replied_account_id;
    if (!accountId) {
      throw new Error("No hay una cuenta de LinkedIn asignada a esta conversación.");
    }

    const account = db.prepare(`
      SELECT id, name, unipile_account_id, is_authenticated FROM accounts WHERE id = ?
    `).get(accountId) as { id: string; name: string; unipile_account_id?: string | null; is_authenticated: number } | undefined;

    if (!account) {
      throw new Error(`La cuenta de LinkedIn ${accountId} no existe.`);
    }
    const linkedInState = ensureLinkedInTargetAccountState(db, accountId, target);
    target.unipile_provider_id = linkedInState.unipile_provider_id;
    target.unipile_chat_id = linkedInState.unipile_chat_id;

    try {
      if (!unipile.isConfigured()) {
        throw new Error("El motor de LinkedIn no está configurado");
      }
      const resolved = await resolveUnipileAccount(db, accountId, unipile);
      if (externalThreadId && !externalThreadId.startsWith("thread-")) {
        const sent = await unipile.sendMessage({
          chat_id: externalThreadId,
          text: textToSend,
        });
        if (!sent?.message_id) throw new Error("El motor de LinkedIn no confirmó el envío");
        externalMessageId = sent.message_id;
      } else {
        const recipientIdentifier = target.messaging_urn || target.linkedin_url || target.unipile_provider_id;
        if (!recipientIdentifier) {
          throw new Error("El prospecto no tiene identificador de mensajería ni URL de LinkedIn.");
        }
        const started = await unipile.startChat({
          account_id: resolved.unipileAccountId,
          text: textToSend,
          attendees_ids: [recipientIdentifier],
        });
        if (!started?.message_id && !started?.chat_id) {
          throw new Error("El motor de LinkedIn no confirmó la apertura del chat.");
        }
        externalMessageId = started.message_id || externalMessageId;
        externalThreadId = started.chat_id || externalThreadId;
      }

      markLinkedInTargetState(db, accountId, target.id, {
        unipile_chat_id: externalThreadId,
        message_sent_at: new Date().toISOString(),
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      db.prepare(`
        UPDATE sdr_actions
        SET state = 'failed', delivery_status = 'failed', updated_at = datetime('now')
        WHERE id = ?
      `).run(action.id);
      db.prepare(`
        UPDATE sdr_outbox
        SET state = 'failed', last_error = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(errorMsg, outboxId);
      throw new Error(`Error al enviar mensaje por LinkedIn: ${errorMsg}`);
    }

    // Persist outbound in LinkedIn inbox table and SDR messages table
    db.transaction(() => {
      db.prepare(`
        INSERT INTO linkedin_inbox_messages (
          id, account_id, target_id, external_thread_id, external_message_id,
          direction, sender_name, body, sent_at, identity_mode, metadata_json
        ) VALUES (?, ?, ?, ?, ?, 'outbound', ?, ?, datetime('now'), 'profile_url', ?)
        ON CONFLICT(account_id, external_thread_id, external_message_id) DO NOTHING
      `).run(
        randomUUID(),
        accountId,
        target.id,
        externalThreadId,
        externalMessageId,
        account.name || "Me",
        textToSend,
        JSON.stringify({ sentVia: "sdr_action_dispatch", actionId: action.id }),
      );

      db.prepare(`
        INSERT INTO sdr_messages (
          id, thread_id, direction, external_message_id, sender_name,
          body, content_hash, sent_at, delivery_status, metadata_json
        ) VALUES (?, ?, 'outbound', ?, ?, ?, ?, datetime('now'), 'delivered', ?)
        ON CONFLICT(thread_id, external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING
      `).run(
        randomUUID(),
        thread.id,
        externalMessageId,
        account.name || "Me",
        textToSend,
        createHash("sha256").update(textToSend, "utf8").digest("hex"),
        JSON.stringify({ sentVia: "sdr_action_dispatch", actionId: action.id }),
      );

      db.prepare(`
        UPDATE sdr_actions
        SET state = 'completed', delivery_status = 'delivered',
          approved_by_user_id = COALESCE(approved_by_user_id, ?),
          approved_at = COALESCE(approved_at, datetime('now')),
          edited_payload_json = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(options.actorUserId, JSON.stringify({ body: textToSend }), action.id);

      db.prepare(`
        UPDATE sdr_threads
        SET state = 'WAITING_LEAD',
          latest_processed_message_id = ?,
          external_thread_id = CASE WHEN external_thread_id IS NULL OR external_thread_id LIKE 'thread-%' THEN ? ELSE external_thread_id END,
          ai_turn_count = ai_turn_count + 1,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(action.message_id || externalMessageId, externalThreadId, thread.id);

      db.prepare(`
        UPDATE sdr_outbox
        SET state = 'sent', provider_message_id = ?, provider_thread_id = ?,
          sent_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(externalMessageId, externalThreadId, outboxId);
    })();
  } else {
    // 2. Email Channel
    const emailAccountId = thread.email_account_id;
    if (!emailAccountId) {
      throw new Error("No hay una cuenta de Email asignada a esta conversación.");
    }

    if (!target.email) {
      throw new Error("El prospecto no tiene una dirección de correo válida.");
    }

    const emailAccount = db.prepare(`
      SELECT id, from_email, from_name, reply_to, smtp_host, smtp_port,
        smtp_secure, username, password
      FROM email_accounts WHERE id = ?
    `).get(emailAccountId) as {
      id: string;
      from_email: string;
      from_name: string | null;
      reply_to: string | null;
      smtp_host: string;
      smtp_port: number;
      smtp_secure: number;
      username: string;
      password: string;
    } | undefined;

    if (!emailAccount) {
      throw new Error(`Cuenta de correo ${emailAccountId} no encontrada.`);
    }

    let password = emailAccount.password;
    try {
      const decrypted = decryptSecret(emailAccount.password);
      if (decrypted) password = decrypted;
    } catch {
      // not encrypted
    }

    try {
      await sendEmail(
        {
          ...emailAccount,
          password,
        },
        target.email,
        `Re: Conversación con ${emailAccount.from_name || "InHubFlow"}`,
        textToSend,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      db.prepare(`
        UPDATE sdr_actions
        SET state = 'failed', delivery_status = 'failed', updated_at = datetime('now')
        WHERE id = ?
      `).run(action.id);
      db.prepare(`
        UPDATE sdr_outbox
        SET state = 'failed', last_error = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(errorMsg, outboxId);
      throw new Error(`Error al enviar correo: ${errorMsg}`);
    }

    db.transaction(() => {
      // B6 fix: Correct columns, sender_name, and conflict target
      db.prepare(`
        INSERT INTO sdr_messages (
          id, thread_id, direction, external_message_id, sender_name,
          body, content_hash, sent_at, delivery_status, metadata_json
        ) VALUES (?, ?, 'outbound', ?, ?, ?, ?, datetime('now'), 'delivered', ?)
        ON CONFLICT(thread_id, external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING
      `).run(
        randomUUID(),
        thread.id,
        externalMessageId,
        emailAccount.from_name || "InHubFlow",
        textToSend,
        createHash("sha256").update(textToSend, "utf8").digest("hex"),
        JSON.stringify({ sentVia: "sdr_action_dispatch", actionId: action.id }),
      );

      db.prepare(`
        UPDATE sdr_actions
        SET state = 'completed', delivery_status = 'delivered',
          approved_by_user_id = COALESCE(approved_by_user_id, ?),
          approved_at = COALESCE(approved_at, datetime('now')),
          edited_payload_json = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(options.actorUserId, JSON.stringify({ body: textToSend }), action.id);

      db.prepare(`
        UPDATE sdr_threads
        SET state = 'WAITING_LEAD',
          latest_processed_message_id = ?,
          ai_turn_count = ai_turn_count + 1,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(action.message_id || externalMessageId, thread.id);

      db.prepare(`
        UPDATE sdr_outbox
        SET state = 'sent', provider_message_id = ?, provider_thread_id = ?,
          sent_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(externalMessageId, externalThreadId, outboxId);
    })();
  }

  recordSdrAuditEvent(db, {
    workspaceOwnerId: options.workspaceOwnerId,
    actorType: "user",
    actorUserId: options.actorUserId,
    entityType: "action",
    entityId: action.id,
    eventType: "sdr_action_dispatched",
    threadId: thread.id,
    actionId: action.id,
    correlationId: externalMessageId,
    idempotencyKey: `audit:dispatch:${action.id}`,
    payload: { channel, length: textToSend.length },
  });

  return {
    success: true,
    actionId: action.id,
    threadId: thread.id,
    channel,
    deliveryStatus: "delivered",
    messageId: externalMessageId,
  };
}
