import crypto from "crypto";
import { getDb } from "@/lib/db";
import { ingestUnipileMessage } from "@/lib/unipile/inbox-sync";
import { markLinkedInTargetState } from "@/lib/linkedin/account-state";
import type { UnipileWebhookPayload } from "./types";

export interface ProcessWebhookResult {
  handled: boolean;
  event: string;
  message?: string;
  details?: Record<string, unknown>;
}

function localAccountForRemote(db: ReturnType<typeof getDb>, accountId?: string) {
  if (!accountId) return undefined;
  return db.prepare(`SELECT id, name, email, unipile_account_id FROM accounts WHERE unipile_account_id = ? LIMIT 1`).get(accountId) as
    | { id: string; name: string; email: string; unipile_account_id?: string }
    | undefined;
}

function getMessageFields(payload: UnipileWebhookPayload) {
  const data = payload.data || {};
  const sender = payload.sender || data.sender || {};
  return {
    messageId: payload.message_id || data.message_id || data.id,
    chatId: payload.chat_id || data.chat_id,
    text: payload.message ?? data.message ?? data.text ?? "",
    timestamp: payload.timestamp || data.timestamp || new Date().toISOString(),
    senderId: sender.attendee_provider_id || sender.provider_id || data.sender_id || "",
    senderName: sender.attendee_name || sender.name || data.sender_name || "Contacto",
    senderProfileUrl: sender.attendee_profile_url || sender.profile_url || data.sender_profile_url || null,
    accountUserId: payload.account_info?.user_id || data.account_info?.user_id || "",
    attachments: payload.attachments || data.attachments || [],
  };
}

export async function handleUnipileWebhook(payload: UnipileWebhookPayload, customDb?: ReturnType<typeof getDb>): Promise<ProcessWebhookResult> {
  const db = customDb || getDb();
  const event = String(payload.event || "");
  const remoteAccountId = payload.account_id || payload.data?.account_id;
  const localAccount = localAccountForRemote(db, remoteAccountId);

  if (event === "message_received") {
    if (!localAccount) return { handled: false, event, message: "Cuenta de LinkedIn no asociada a una cuenta local" };
    const fields = getMessageFields(payload);
    if (!fields.messageId || !fields.chatId) return { handled: false, event, message: "Payload incompleto: falta message_id o chat_id" };
    const isSender = fields.accountUserId ? fields.accountUserId === fields.senderId : Boolean(payload.data?.is_sender);
    const result = await ingestUnipileMessage(db, {
      localAccountId: localAccount.id,
      message: {
        id: fields.messageId,
        message_id: fields.messageId,
        chat_id: fields.chatId,
        account_id: remoteAccountId,
        sender_id: fields.senderId,
        text: fields.text,
        timestamp: fields.timestamp,
        is_sender: isSender,
        attachments: fields.attachments,
      },
      profile: {
        providerId: fields.senderId || null,
        name: fields.senderName || null,
        profileUrl: fields.senderProfileUrl,
        memberUrn: fields.senderId || null,
      },
      source: "linkedin-webhook",
    });
    return { handled: true, event, message: "Mensaje procesado correctamente", details: { ...result, messageId: fields.messageId, chatId: fields.chatId } };
  }

  if (event === "new_relation" || event === "invitation_accepted") {
    const data = payload.data || {};
    const providerId = payload.user_provider_id || data.user_provider_id || data.provider_id || data.user_id;
    if (!localAccount || !providerId) return { handled: false, event, message: "Relación sin cuenta local o provider_id" };
    const targets = db.prepare(`
      SELECT DISTINCT t.id
      FROM targets t
      LEFT JOIN linkedin_target_accounts lta
        ON lta.target_id = t.id AND lta.account_id = ?
      WHERE (lta.unipile_provider_id = ? OR t.unipile_provider_id = ? OR t.messaging_urn = ?)
        AND (
          EXISTS (SELECT 1 FROM run_profiles rp JOIN runs r ON r.id = rp.run_id WHERE rp.target_id = t.id AND r.account_id = ?)
          OR EXISTS (SELECT 1 FROM linkedin_inbox_messages m WHERE m.target_id = t.id AND m.account_id = ?)
        )
    `).all(localAccount.id, providerId, providerId, providerId, localAccount.id, localAccount.id) as Array<{ id: string }>;
    db.transaction(() => {
      for (const target of targets) {
        markLinkedInTargetState(db, localAccount.id, target.id, {
          unipile_provider_id: providerId,
          degree: 1,
          connected_at: new Date().toISOString(),
        });
      }
    })();
    const wake = db.prepare(`
      UPDATE run_profile_tracks SET state = 'in_progress', next_step_at = datetime('now'), error_message = NULL
      WHERE state IN ('pending', 'in_progress') AND run_profile_id IN (
        SELECT rp.id FROM run_profiles rp JOIN runs r ON r.id = rp.run_id
        JOIN targets t ON t.id = rp.target_id
        WHERE r.account_id = ? AND (t.unipile_provider_id = ? OR t.messaging_urn = ?)
      )
    `).run(localAccount.id, providerId, providerId);
    return { handled: true, event, message: "Nueva relación registrada y secuencias despertadas", details: { providerId, targetsUpdated: targets.length, tracksWoken: wake.changes } };
  }

  if (
    event === "account_status_changed" ||
    event === "account_status_ok" ||
    event === "account_reconnected" ||
    event === "account_creation_success" ||
    event === "account_sync_success" ||
    event === "account_connecting" ||
    event === "account_credentials" ||
    event === "account_error" ||
    event === "account_stopped" ||
    event === "account_permissions" ||
    event === "account_creation_fail" ||
    event === "account_deletion" ||
    event === "account_deleted" ||
    event === "account.status.disconnected" ||
    payload.AccountStatus
  ) {
    const data = payload.data || {};
    const accountStatus = payload.AccountStatus || {};
    let status = (accountStatus.message || data.message || data.status || payload.status || "").toUpperCase();
    if (!status) {
      if (event.includes("ok") || event.includes("reconnected") || event.includes("success")) {
        status = "OK";
      } else if (event.includes("credentials") || event.includes("disconnected")) {
        status = "CREDENTIALS";
      } else if (event.includes("error") || event.includes("fail")) {
        status = "ERROR";
      } else if (event.includes("stopped")) {
        status = "STOPPED";
      } else if (event.includes("connecting")) {
        status = "CONNECTING";
      } else if (event.includes("permissions")) {
        status = "PERMISSIONS";
      } else {
        status = "OK";
      }
    }

    const accountId = accountStatus.account_id || remoteAccountId;
    const account = localAccountForRemote(db, accountId);
    if (!account) {
      return { handled: false, event, message: "Cuenta de LinkedIn no asociada a una cuenta local" };
    }
    const isAuthenticated = status === "OK" ? 1 : 0;

    db.prepare(`
      UPDATE accounts
      SET unipile_status = ?, is_authenticated = ?
      WHERE id = ?
    `).run(status, isAuthenticated, account.id);

    return {
      handled: true,
      event,
      message: `Estado de la cuenta actualizado a: ${status}`,
      details: { accountId, localAccountId: account.id },
    };
  }

  return { handled: false, event, message: `Evento '${event}' no requiere acción específica` };
}

export function verifyUnipileSignature(rawBody: Buffer, header: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  if (!header || !secret) return false;
  const fields = Object.fromEntries(header.split(",").map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [part.trim(), ""] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
  const timestamp = Number(fields.t);
  const supplied = String(fields.v0 || "").toLowerCase();
  if (!Number.isFinite(timestamp) || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${fields.t}.${rawBody.toString("utf8")}`, "utf8").digest("hex");
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function createUnipileSignature(rawBody: Buffer, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const digest = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`, "utf8").digest("hex");
  return `t=${timestamp},v0=${digest}`;
}

export type { UnipileWebhookPayload } from "./types";
