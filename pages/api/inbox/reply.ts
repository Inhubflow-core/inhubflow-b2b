import { createHash, randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { canAccessEmailAccount, requireApiActor, targetBelongsToEmailAccount } from "@/lib/authz";
import { sendEmail } from "@/lib/email/sender";
import { decryptSecret } from "@/lib/crypto";
import { takeHumanControl } from "@/lib/sdr-agent/handoff";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }
  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const { targetId, threadId, emailAccountId, to, subject, body } = req.body as {
    targetId?: string;
    threadId?: string | null;
    emailAccountId?: string;
    to?: string;
    subject?: string;
    body?: string;
  };
  if (!targetId || !emailAccountId || !to || !subject || !body?.trim()) {
    return res.status(400).json({ error: "targetId, emailAccountId, to, subject, and body are required" });
  }
  if (body.length > 100_000 || subject.length > 998) {
    return res.status(400).json({ error: "Email content exceeds the allowed size" });
  }

  const db = getDb();
  if (!canAccessEmailAccount(db, actor, emailAccountId)) {
    return res.status(404).json({ error: "Email account not found" });
  }
  if (!targetBelongsToEmailAccount(db, targetId, emailAccountId)) {
    return res.status(404).json({ error: "Target not found for this email account" });
  }
  const target = db.prepare("SELECT id, email FROM targets WHERE id = ?").get(targetId) as
    | { id: string; email: string | null }
    | undefined;
  if (!target?.email || target.email.trim().toLowerCase() !== to.trim().toLowerCase()) {
    return res.status(400).json({ error: "Recipient does not match the selected contact" });
  }
  const account = db.prepare(`
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
  if (!account) return res.status(404).json({ error: "Email account not found" });

  const sdrThread = threadId
    ? db.prepare(`
        SELECT id, external_thread_id FROM sdr_threads
        WHERE id = ? AND target_id = ? AND channel = 'email' AND email_account_id = ?
      `).get(threadId, targetId, emailAccountId) as { id: string; external_thread_id: string } | undefined
    : db.prepare(`
        SELECT id, external_thread_id FROM sdr_threads
        WHERE target_id = ? AND channel = 'email' AND email_account_id = ?
        ORDER BY updated_at DESC LIMIT 1
      `).get(targetId, emailAccountId) as { id: string; external_thread_id: string } | undefined;
  if (threadId && !sdrThread) return res.status(404).json({ error: "Conversation not found" });
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

  const latestInbound = sdrThread
    ? db.prepare(`
        SELECT external_message_id, metadata_json FROM sdr_messages
        WHERE thread_id = ? AND direction = 'inbound'
        ORDER BY datetime(sent_at) DESC, id DESC LIMIT 1
      `).get(sdrThread.id) as { external_message_id: string | null; metadata_json: string } | undefined
    : undefined;
  let references: string[] = [];
  try {
    const metadata = latestInbound ? JSON.parse(latestInbound.metadata_json) as { references?: unknown } : {};
    if (Array.isArray(metadata.references)) references = metadata.references.map(String);
  } catch { /* malformed legacy metadata */ }
  if (latestInbound?.external_message_id && !references.includes(latestInbound.external_message_id)) {
    references.push(latestInbound.external_message_id);
  }

  const actionId = randomUUID();
  const messageIdDomain = process.env.EMAIL_MESSAGE_ID_DOMAIN?.trim() || new URL(process.env.NEXTAUTH_URL || "http://localhost").hostname || "inhubflow.local";
  const outboundMessageId = `<sdr-${actionId}@${messageIdDomain}>`;
  try {
    const result = await sendEmail(
      { ...account, password: decryptSecret(account.password)! },
      target.email,
      subject.trim(),
      body.trim(),
      {
        messageId: outboundMessageId,
        inReplyTo: latestInbound?.external_message_id ?? null,
        references,
      },
    );
    if (result.rejected.length > 0 || result.accepted.length === 0) {
      return res.status(502).json({ error: "SMTP did not accept the recipient" });
    }
    if (sdrThread) {
      const sentAt = new Date().toISOString();
      db.transaction(() => {
        db.prepare(`
          INSERT INTO sdr_messages (
            id, thread_id, direction, external_message_id, sender_external_id,
            sender_name, body, content_hash, sent_at, captured_at,
            delivery_status, metadata_json
          ) VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, 'sent', ?)
          ON CONFLICT(thread_id, external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING
        `).run(
          randomUUID(), sdrThread.id, result.messageId || outboundMessageId,
          account.from_email, account.from_name, body.trim(),
          createHash("sha256").update(body.trim(), "utf8").digest("hex"),
          sentAt, sentAt,
          JSON.stringify({ source: "human-inbox-reply", subject: subject.trim(), references, smtpResponse: result.response }),
        );
        db.prepare("UPDATE sdr_threads SET last_outbound_at = ?, updated_at = datetime('now') WHERE id = ?")
          .run(sentAt, sdrThread.id);
      })();
    }
    return res.json({ ok: true, messageId: result.messageId || outboundMessageId });
  } catch (error) {
    console.error("[inbox/reply] send failed:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Send failed" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "150kb" } } };
