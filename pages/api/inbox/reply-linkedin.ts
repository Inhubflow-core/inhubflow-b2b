import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { canAccessLinkedInAccount, requireApiActor, targetBelongsToLinkedInAccount } from "@/lib/authz";
import { takeHumanControl } from "@/lib/sdr-agent/handoff";
import { unipile } from "@/lib/unipile/client";

interface AttachmentPayload {
  name: string;
  type: string;
  dataUrl: string; // base64 data url
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

  const db = getDb();
  if (!canAccessLinkedInAccount(db, actor, accountId)) {
    return res.status(404).json({ error: "Account not found" });
  }
  if (!targetBelongsToLinkedInAccount(db, targetId, accountId)) {
    return res.status(404).json({ error: "Target not found for this account" });
  }

  const target = db.prepare(`
    SELECT id, full_name, linkedin_url, messaging_urn, unipile_provider_id, unipile_chat_id
    FROM targets WHERE id = ?
  `).get(targetId) as {
    id: string;
    full_name: string;
    linkedin_url: string;
    messaging_urn?: string | null;
    unipile_provider_id?: string | null;
    unipile_chat_id?: string | null;
  } | undefined;

  if (!target) return res.status(404).json({ error: "Target not found" });

  const account = db.prepare("SELECT id, name, unipile_account_id, is_authenticated FROM accounts WHERE id = ?").get(accountId) as
    | { id: string; name: string; unipile_account_id?: string | null; is_authenticated: number }
    | undefined;

  if (!account) return res.status(404).json({ error: "Account not found" });

  // Get active run / workflow if available
  const runProfile = db.prepare(`
    SELECT rp.run_id, r.workflow_id
    FROM run_profiles rp
    JOIN runs r ON r.id = rp.run_id
    WHERE rp.target_id = ? AND r.account_id = ?
    LIMIT 1
  `).get(targetId, accountId) as { run_id?: string; workflow_id?: string } | undefined;

  const sdrThread = db.prepare(`
    SELECT id FROM sdr_threads
    WHERE target_id = ? AND channel = 'linkedin' AND linkedin_account_id = ?
      AND (? IS NULL OR external_thread_id = ?)
    ORDER BY updated_at DESC LIMIT 1
  `).get(targetId, accountId, threadId ?? null, threadId ?? null) as { id: string } | undefined;

  if (sdrThread) {
    try {
      takeHumanControl(db, {
        threadId: sdrThread.id,
        actorUserId: actor.id,
        workspaceOwnerId: actor.workspaceOwnerId,
        allowAdministrativeOverride: actor.isWorkspaceAdmin,
      });
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Conversation is locked" });
    }
  }

  const finalBody = messageText?.trim()
    ? (attachment ? `${messageText.trim()}\n\n📎 [Archivo adjunto: ${attachment.name}]` : messageText.trim())
    : (attachment ? `📎 [Archivo adjunto: ${attachment.name}]` : "");

  let externalThreadId = threadId || target.unipile_chat_id || `thread-${target.id}`;
  let externalMessageId = `msg-${Date.now()}`;
  const sentAt = new Date().toISOString();

  try {
    // Envío oficial a través de Unipile API
    if (unipile.isConfigured()) {
      const unipileAccId = account.unipile_account_id || account.id;

      if (threadId && !threadId.startsWith("thread-")) {
        // Enviar a chat existente
        const sent = await unipile.sendMessage({
          chat_id: threadId,
          text: finalBody,
        });
        if (sent?.id) externalMessageId = sent.id;
      } else {
        // Si no hay threadId conocido, resolver el provider_id del target e iniciar chat
        let providerId = target.unipile_provider_id;
        if (!providerId && target.linkedin_url) {
          try {
            const profile = await unipile.resolveProfile(target.linkedin_url, unipileAccId);
            providerId = profile.provider_id;
            if (providerId) {
              db.prepare("UPDATE targets SET unipile_provider_id = ? WHERE id = ?").run(providerId, target.id);
            }
          } catch (err) {
            console.warn("[reply-linkedin] No se pudo resolver profile en Unipile:", err);
          }
        }

        if (providerId) {
          const newChat = await unipile.startChat({
            account_id: unipileAccId,
            attendees_ids: [providerId],
            text: finalBody,
          });
          if (newChat?.id) {
            externalThreadId = newChat.id;
            db.prepare("UPDATE targets SET unipile_chat_id = ? WHERE id = ?").run(newChat.id, target.id);
          }
        } else {
          throw new Error("No se pudo obtener el identificador de LinkedIn del contacto en Unipile");
        }
      }
    } else {
      console.warn("[reply-linkedin] UNIPILE_DSN o UNIPILE_API_KEY no configurado, simulando guardado local");
    }

    // Persistir mensaje saliente en la base de datos
    const messageId = `outbound-${crypto.randomUUID()}`;
    const metadata = {
      source: "inbox-unipile-reply",
      attachment: attachment ? { name: attachment.name, type: attachment.type } : null,
    };

    db.prepare(`
      INSERT INTO linkedin_inbox_messages (
        id, account_id, target_id, run_id, workflow_id,
        external_thread_id, external_message_id, direction,
        sender_external_id, sender_name, body, sent_at, identity_mode, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'outbound', ?, ?, ?, ?, 'messaging_urn', ?)
    `).run(
      messageId,
      accountId,
      targetId,
      runProfile?.run_id ?? null,
      runProfile?.workflow_id ?? null,
      externalThreadId,
      externalMessageId,
      target.linkedin_url || "",
      account.name || "Me",
      finalBody,
      sentAt,
      JSON.stringify(metadata)
    );

    if (sdrThread) {
      db.transaction(() => {
        db.prepare(`
          INSERT INTO sdr_messages (
            id, thread_id, direction, external_message_id, sender_name, body,
            content_hash, sent_at, captured_at, delivery_status, metadata_json
          ) VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, ?, 'sent', ?)
          ON CONFLICT(thread_id, external_message_id) DO NOTHING
        `).run(
          crypto.randomUUID(),
          sdrThread.id,
          externalMessageId,
          account.name || "Me",
          finalBody,
          crypto.createHash("sha256").update(finalBody, "utf8").digest("hex"),
          sentAt,
          sentAt,
          JSON.stringify({ source: "human-inbox-reply", channel: "linkedin" })
        );
        db.prepare(`
          UPDATE sdr_threads SET last_outbound_at = ?, updated_at = datetime('now') WHERE id = ?
        `).run(sentAt, sdrThread.id);
      })();
    }

    // Registrar log
    if (runProfile?.run_id) {
      db.prepare(`
        INSERT INTO logs (id, run_id, target_id, message, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(
        crypto.randomUUID(),
        runProfile.run_id,
        targetId,
        `Mensaje de LinkedIn enviado a ${target.full_name} vía Unipile`
      );
    }

    return res.status(200).json({ ok: true, messageId, sentAt, body: finalBody, threadId: externalThreadId });
  } catch (error) {
    console.error("[reply-linkedin] Error enviando mensaje:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Error enviando mensaje por LinkedIn",
    });
  }
}
