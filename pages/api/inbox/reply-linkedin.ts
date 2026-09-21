import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { canAccessLinkedInAccount, requireApiActor, targetBelongsToLinkedInAccount } from "@/lib/authz";
import { takeHumanControl } from "@/lib/sdr-agent/handoff";
import { unipile } from "@/lib/unipile/client";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import { ensureLinkedInTargetAccountState, markLinkedInTargetState } from "@/lib/linkedin/account-state";

interface AttachmentPayload {
  name: string;
  type: string;
  dataUrl: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const { targetId, accountId, messageText, threadId, attachment } = req.body as {
    targetId?: string;
    accountId?: string;
    messageText?: string;
    threadId?: string;
    attachment?: AttachmentPayload | null;
  };

  if (!targetId || !accountId || (!messageText?.trim() && !attachment)) {
    return res.status(400).json({ error: "Missing required fields (targetId, accountId, and messageText or attachment)" });
  }
  if (attachment) return res.status(400).json({ error: "Los adjuntos del Inbox de LinkedIn aún no están habilitados" });

  const db = getDb();
  if (!canAccessLinkedInAccount(db, actor, accountId)) return res.status(404).json({ error: "Account not found" });
  if (!targetBelongsToLinkedInAccount(db, targetId, accountId)) return res.status(404).json({ error: "Target not found for this account" });

  const target = db.prepare(`
    SELECT id, full_name, linkedin_url, messaging_urn, unipile_provider_id, unipile_chat_id
    FROM targets WHERE id = ?
  `).get(targetId) as {
    id: string; full_name: string; linkedin_url: string; messaging_urn?: string | null;
    unipile_provider_id?: string | null; unipile_chat_id?: string | null;
  } | undefined;
  if (!target) return res.status(404).json({ error: "Target not found" });

  const account = db.prepare("SELECT id, name, unipile_account_id, is_authenticated FROM accounts WHERE id = ?").get(accountId) as
    | { id: string; name: string; unipile_account_id?: string | null; is_authenticated: number }
    | undefined;
  if (!account) return res.status(404).json({ error: "Account not found" });
  const linkedInState = ensureLinkedInTargetAccountState(db, accountId, target);
  target.unipile_provider_id = linkedInState.unipile_provider_id;
  target.unipile_chat_id = linkedInState.unipile_chat_id;
  if (!unipile.isConfigured()) return res.status(503).json({ error: "El motor de LinkedIn no está configurado" });

  const runProfile = db.prepare(`
    SELECT rp.run_id, r.workflow_id FROM run_profiles rp JOIN runs r ON r.id = rp.run_id
    WHERE rp.target_id = ? AND r.account_id = ? LIMIT 1
  `).get(targetId, accountId) as { run_id?: string; workflow_id?: string } | undefined;

  const sdrThread = db.prepare(`
    SELECT id FROM sdr_threads
    WHERE target_id = ? AND channel = 'linkedin' AND linkedin_account_id = ?
      AND (? IS NULL OR external_thread_id = ?)
    ORDER BY updated_at DESC LIMIT 1
  `).get(targetId, accountId, threadId ?? null, threadId ?? null) as { id: string } | undefined;
  if (sdrThread) {
    try {
      takeHumanControl(db, { threadId: sdrThread.id, actorUserId: actor.id, workspaceOwnerId: actor.workspaceOwnerId, allowAdministrativeOverride: actor.isWorkspaceAdmin });
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Conversation is locked" });
    }
  }

  const finalBody = messageText?.trim() || "";
  let externalThreadId = threadId || target.unipile_chat_id || `thread-${target.id}`;
  let externalMessageId = "";
  const sentAt = new Date().toISOString();

  try {
    const resolved = await resolveUnipileAccount(db, accountId, unipile);
    if (threadId && !threadId.startsWith("thread-")) {
      const sent = await unipile.sendMessage({ chat_id: threadId, text: finalBody });
      externalMessageId = sent?.message_id || "";
    } else {
      let providerId = target.unipile_provider_id;
      if (!providerId && target.linkedin_url) {
        const profile = await unipile.resolveProfile(target.linkedin_url, resolved.unipileAccountId);
        providerId = profile.provider_id;
        const photoUrl = profile.profile_picture_url_large || profile.profile_picture_url || ((profile as unknown as { picture_url?: string }).picture_url ?? null);
        if (providerId) markLinkedInTargetState(db, accountId, target.id, { unipile_provider_id: providerId });
        if (photoUrl) {
          db.prepare("UPDATE targets SET profile_image_url = COALESCE(profile_image_url, ?) WHERE id = ?").run(photoUrl, target.id);
        }
      }
      if (!providerId) throw new Error("No se pudo identificar el contacto de LinkedIn");
      const newChat = await unipile.startChat({ account_id: resolved.unipileAccountId, attendees_ids: [providerId], text: finalBody });
      externalThreadId = newChat?.chat_id || "";
      externalMessageId = newChat?.message_id || "";
    }
    if (!externalThreadId || !externalMessageId) throw new Error("El motor de LinkedIn no confirmó el envío del mensaje");
    if (!target.unipile_chat_id) markLinkedInTargetState(db, accountId, target.id, { unipile_chat_id: externalThreadId });

    const messageId = `outbound-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO linkedin_inbox_messages (
        id, account_id, target_id, run_id, workflow_id, external_thread_id,
        external_message_id, direction, sender_external_id, sender_name, body,
        sent_at, identity_mode, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'outbound', ?, ?, ?, ?, 'messaging_urn', ?)
    `).run(messageId, accountId, targetId, runProfile?.run_id ?? null, runProfile?.workflow_id ?? null, externalThreadId, externalMessageId, target.linkedin_url || "", account.name || "Me", finalBody, sentAt, JSON.stringify({ source: "inbox-linkedin-reply" }));

    if (sdrThread) {
      db.transaction(() => {
        db.prepare(`INSERT INTO sdr_messages (id, thread_id, direction, external_message_id, sender_name, body, content_hash, sent_at, captured_at, delivery_status, metadata_json) VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, ?, 'sent', ?) ON CONFLICT(thread_id, external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING`).run(crypto.randomUUID(), sdrThread.id, externalMessageId, account.name || "Me", finalBody, crypto.createHash("sha256").update(finalBody, "utf8").digest("hex"), sentAt, sentAt, JSON.stringify({ source: "human-inbox-reply", channel: "linkedin" }));
        db.prepare("UPDATE sdr_threads SET last_outbound_at = ?, updated_at = datetime('now') WHERE id = ?").run(sentAt, sdrThread.id);
      })();
    }
    if (runProfile?.run_id) db.prepare("INSERT INTO logs (id, run_id, target_id, level, message) VALUES (?, ?, ?, 'info', ?)").run(crypto.randomUUID(), runProfile.run_id, targetId, `Mensaje enviado a ${target.full_name} con éxito!`);
    return res.status(200).json({ ok: true, messageId, sentAt, body: finalBody, threadId: externalThreadId });
  } catch (error) {
    console.error("[reply-linkedin] Error enviando mensaje:", error);
    return res.status(502).json({ error: error instanceof Error ? error.message : "Error enviando mensaje por LinkedIn" });
  }
}
