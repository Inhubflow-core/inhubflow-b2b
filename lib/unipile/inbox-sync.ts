import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { unipile, UnipileClient } from "@/lib/unipile/client";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import type { UnipileChat, UnipileChatAttendee, UnipileMessage } from "@/lib/unipile/types";
import { captureSdrInboundMessage } from "@/lib/sdr-agent/repository";
import {
  ensureLinkedInTargetAccountState,
  markLinkedInTargetState,
} from "@/lib/linkedin/account-state";

export interface InboxSyncResult {
  chats: number;
  messages: number;
  duplicates: number;
  createdTargets: number;
  accountId: string;
  providerAccountId: string;
}

interface LocalTarget {
  id: string;
  full_name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  linkedin_url: string | null;
  messaging_urn: string | null;
  unipile_provider_id: string | null;
  unipile_chat_id: string | null;
  run_id?: string | null;
  workflow_id?: string | null;
}

function normalize(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function attendeeProfile(attendee?: UnipileChatAttendee | null) {
  return {
    providerId: attendee?.provider_id || null,
    name: attendee?.name || null,
    profileUrl: attendee?.profile_url || null,
    pictureUrl: attendee?.picture_url || null,
    memberUrn: attendee?.specifics?.member_urn || null,
  };
}

function targetForMessage(
  db: Database.Database,
  accountId: string,
  chatId: string,
  senderId: string | null,
  profileUrl: string | null,
  providerId: string | null,
): LocalTarget | undefined {
  return db.prepare(`
    SELECT t.id, t.full_name, t.first_name, t.last_name, t.linkedin_url,
           COALESCE(lta.unipile_provider_id, t.unipile_provider_id) AS unipile_provider_id,
           COALESCE(lta.unipile_chat_id, scoped_message.external_thread_id) AS unipile_chat_id,
           COALESCE(t.messaging_urn, lta.unipile_provider_id) AS messaging_urn,
           (SELECT rp.run_id FROM run_profiles rp JOIN runs r ON r.id = rp.run_id
            WHERE rp.target_id = t.id AND r.account_id = ? ORDER BY rp.created_at DESC LIMIT 1) AS run_id,
           (SELECT r.workflow_id FROM run_profiles rp JOIN runs r ON r.id = rp.run_id
            WHERE rp.target_id = t.id AND r.account_id = ? ORDER BY rp.created_at DESC LIMIT 1) AS workflow_id
    FROM targets t
    LEFT JOIN linkedin_target_accounts lta
      ON lta.target_id = t.id AND lta.account_id = ?
    LEFT JOIN linkedin_inbox_messages scoped_message
      ON scoped_message.id = (
        SELECT m.id FROM linkedin_inbox_messages m
        WHERE m.account_id = ? AND m.target_id = t.id
        ORDER BY datetime(m.sent_at) DESC, m.id DESC LIMIT 1
      )
    WHERE lta.unipile_chat_id = ?
       OR scoped_message.external_thread_id = ?
       OR (? IS NOT NULL AND (
         lta.unipile_provider_id = ? OR t.unipile_provider_id = ? OR t.messaging_urn = ?
       ))
       OR (? IS NOT NULL AND lower(t.linkedin_url) = lower(?))
    ORDER BY CASE
      WHEN lta.unipile_chat_id = ? OR scoped_message.external_thread_id = ? THEN 0
      WHEN lta.unipile_provider_id = ? THEN 1 ELSE 2 END,
      t.created_at ASC
    LIMIT 1
  `).get(
    accountId, accountId, accountId, accountId,
    chatId, chatId,
    providerId || senderId, providerId || senderId, providerId || senderId, providerId || senderId,
    profileUrl, profileUrl,
    chatId, chatId, providerId || senderId,
  ) as LocalTarget | undefined;
}

function createTarget(
  db: Database.Database,
  accountId: string,
  profile: { providerId: string | null; name: string | null; profileUrl: string | null; memberUrn: string | null },
): { target: LocalTarget; created: boolean } | null {
  if (!profile.name && !profile.profileUrl && !profile.providerId) return null;
  const existing = targetForMessage(db, accountId, `__none__`, profile.providerId, profile.profileUrl, profile.providerId);
  if (existing) return { target: existing, created: false };
  const id = randomUUID();
  const fullName = profile.name || "Contacto LinkedIn";
  const firstName = fullName.split(/\s+/)[0] || null;
  const lastName = fullName.split(/\s+/).slice(1).join(" ") || null;
  const context = db.prepare(`
    SELECT r.id AS run_id, r.workflow_id
    FROM runs r WHERE r.account_id = ? ORDER BY datetime(r.created_at) DESC LIMIT 1
  `).get(accountId) as { run_id?: string; workflow_id?: string } | undefined;
  try {
    db.prepare(`
      INSERT INTO targets (
        id, full_name, first_name, last_name, linkedin_url, messaging_urn,
        unipile_provider_id, linkedin_member_urn, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, fullName, firstName, lastName, profile.profileUrl, profile.memberUrn || profile.providerId, profile.providerId, profile.memberUrn,);
  } catch {
    const retry = targetForMessage(db, accountId, `__none__`, profile.providerId, profile.profileUrl, profile.providerId);
    if (!retry) return null;
    return { target: retry, created: false };
  }
  return {
    created: true,
    target: {
      id,
      full_name: fullName,
      first_name: firstName,
      last_name: lastName,
      linkedin_url: profile.profileUrl,
      messaging_urn: profile.memberUrn || profile.providerId,
      unipile_provider_id: profile.providerId,
      unipile_chat_id: null,
      run_id: context?.run_id || null,
      workflow_id: context?.workflow_id || null,
    },
  };
}

export async function ingestUnipileMessage(
  db: Database.Database,
  input: {
    localAccountId: string;
    message: Partial<UnipileMessage> & {
      id?: string;
      message_id?: string;
      chat_id: string;
      account_id?: string;
      sender_id?: string;
      text?: string | null;
      timestamp?: string;
      is_sender?: boolean | 0 | 1;
    };
    profile?: { providerId: string | null; name: string | null; profileUrl: string | null; memberUrn: string | null };
    source?: string;
  },
): Promise<{ captured: boolean; targetId: string | null; direction: "inbound" | "outbound" }> {
  const message = input.message;
  const messageId = String(message.message_id || message.id || "").trim();
  const chatId = String(message.chat_id || "").trim();
  if (!messageId || !chatId) throw new Error("Evento de mensaje de LinkedIn incompleto");
  const direction = message.is_sender === true || message.is_sender === 1 ? "outbound" : "inbound";
  const profile = input.profile || { providerId: message.sender_id || null, name: null, profileUrl: null, memberUrn: null };
  let target = targetForMessage(db, input.localAccountId, chatId, message.sender_id || null, profile.profileUrl, profile.providerId);
  let created = false;
  if (!target && direction === "inbound") {
    const result = createTarget(db, input.localAccountId, profile);
    target = result?.target;
    created = Boolean(result?.created);
  }
  if (!target) return { captured: false, targetId: null, direction };

  const sentAt = message.timestamp && !Number.isNaN(Date.parse(message.timestamp)) ? new Date(message.timestamp).toISOString() : new Date().toISOString();
  const text = String(message.text || "").trim();
  if (!text && (!message.attachments || message.attachments.length === 0)) return { captured: false, targetId: target.id, direction };
  const body = text || "[Archivo adjunto]";
  const metadata = JSON.stringify({ source: input.source || "linkedin-cloud", createdTarget: created, attachments: message.attachments || [] });
  const runId = target.run_id || null;
  const workflowId = target.workflow_id || null;
  const result = db.prepare(`
    INSERT INTO linkedin_inbox_messages (
      id, account_id, target_id, run_id, workflow_id, external_thread_id,
      external_message_id, direction, sender_external_id, sender_name, body,
      sent_at, identity_mode, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, external_thread_id, external_message_id) DO NOTHING
  `).run(
    randomUUID(), input.localAccountId, target.id, runId, workflowId, chatId, messageId,
    direction, message.sender_id || profile.providerId || null, profile.name || target.full_name || null,
    body, sentAt, profile.providerId && profile.profileUrl ? "messaging_urn+profile_url" : (profile.profileUrl ? "profile_url" : "messaging_urn"), metadata,
  );
  if (result.changes === 0) return { captured: false, targetId: target.id, direction };

  markLinkedInTargetState(db, input.localAccountId, target.id, {
    unipile_chat_id: chatId,
    ...(profile.providerId ? { unipile_provider_id: profile.providerId } : {}),
  });
  if (direction === "inbound") {
    db.prepare("UPDATE targets SET last_replied_at = ?, last_replied_account_id = ? WHERE id = ?").run(sentAt, input.localAccountId, target.id);
    db.prepare(`
      UPDATE run_profile_tracks SET state = 'skipped', next_step_at = NULL, error_message = 'Lead replied via LinkedIn'
      WHERE state NOT IN ('completed', 'failed', 'skipped') AND run_profile_id IN (
        SELECT rp.id FROM run_profiles rp JOIN runs r ON r.id = rp.run_id
        WHERE rp.target_id = ? AND r.account_id = ?
      )
    `).run(target.id, input.localAccountId);
    try {
      captureSdrInboundMessage(db, {
        eventId: `linkedin-cloud:${input.localAccountId}:${messageId}`,
        channel: "linkedin",
        targetId: target.id,
        accountId: input.localAccountId,
        externalThreadId: chatId,
        externalMessageId: messageId,
        senderExternalId: message.sender_id || profile.providerId || null,
        senderName: profile.name || target.full_name || "Contacto",
        body,
        receivedAt: sentAt,
        metadata: { source: input.source || "linkedin-cloud" },
      });
    } catch (error) { console.warn("[linkedin-inbox] SDR capture failed:", error); }
  }
  return { captured: true, targetId: target.id, direction };
}

async function syncAllPages<T>(load: (cursor?: string) => Promise<{ items: T[]; cursor?: string | null }>, maxPages = 100): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const response = await load(cursor);
    items.push(...(response.items || []));
    if (!response.cursor || response.cursor === cursor) break;
    cursor = response.cursor;
  }
  return items;
}

export async function syncLinkedInInbox(
  db: Database.Database,
  localAccountId: string,
  client: UnipileClient = unipile,
): Promise<InboxSyncResult> {
  const resolved = await resolveUnipileAccount(db, localAccountId, client);
  const chats = await syncAllPages((cursor) => client.listChats(resolved.unipileAccountId, 100, cursor));
  let captured = 0;
  let duplicates = 0;
  let createdTargets = 0;
  for (const chat of chats as UnipileChat[]) {
    const attendeesResponse = await client.listChatAttendees(chat.id);
    const other = (attendeesResponse.items || []).find((attendee) => !attendee.is_self);
    const profile = attendeeProfile(other);
    let target = targetForMessage(db, localAccountId, chat.id, profile.providerId, profile.profileUrl, profile.providerId);
    if (!target && (profile.providerId || profile.profileUrl || profile.name)) {
      const created = createTarget(db, localAccountId, profile);
      target = created?.target;
      if (created?.created) createdTargets++;
    }
    if (target && target.unipile_chat_id !== chat.id) {
      ensureLinkedInTargetAccountState(db, localAccountId, target);
      markLinkedInTargetState(db, localAccountId, target.id, {
        unipile_chat_id: chat.id,
        ...(profile.providerId ? { unipile_provider_id: profile.providerId } : {}),
      });
    }

    const messages = await syncAllPages((cursor) => client.listMessages(chat.id, 100, cursor), 100);
    for (const message of messages as UnipileMessage[]) {
      const before = db.prepare("SELECT 1 FROM linkedin_inbox_messages WHERE account_id = ? AND external_thread_id = ? AND external_message_id = ?").get(localAccountId, chat.id, message.id || message.message_id);
      const result = await ingestUnipileMessage(db, { localAccountId, message: { ...message, chat_id: chat.id }, profile, source: "linkedin-backfill" });
      if (result.captured) captured++;
      else if (before) duplicates++;
    }
  }
  db.prepare("UPDATE accounts SET linkedin_inbox_synced_at = datetime('now'), linkedin_inbox_sync_error = NULL, unipile_status = COALESCE(unipile_status, 'OK') WHERE id = ?").run(localAccountId);
  return { chats: chats.length, messages: captured, duplicates, createdTargets, accountId: localAccountId, providerAccountId: resolved.unipileAccountId };
}

export function markInboxSyncError(db: Database.Database, accountId: string, error: unknown): void {
  db.prepare("UPDATE accounts SET linkedin_inbox_sync_error = ? WHERE id = ?").run(error instanceof Error ? error.message : String(error), accountId);
}

export { attendeeProfile, normalize };
