import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { unipile, UnipileClient } from "@/lib/unipile/client";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import type { UnipileChat, UnipileChatAttendee, UnipileMessage } from "@/lib/unipile/types";
import { captureSdrInboundMessage } from "@/lib/sdr-agent/repository";
import { applyTag } from "@/lib/tags/tags-service";
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

function normalizeName(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
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

function extractLinkedInSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const decoded = decodeURIComponent(url).trim().toLowerCase();
    const match = decoded.match(/linkedin\.com\/in\/([^/?#]+)/i) || decoded.match(/in\/([^/?#]+)/i);
    if (match) return match[1].replace(/\/+$/, "").trim();
    return decoded.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  } catch {
    return String(url).toLowerCase().trim();
  }
}

function targetForMessage(
  db: Database.Database,
  accountId: string,
  chatId: string,
  senderId: string | null,
  profileUrl: string | null,
  providerId: string | null,
  senderName?: string | null,
): LocalTarget | undefined {
  // 1. Direct match by chatId, providerId or exact URL
  const direct = db.prepare(`
    SELECT t.id, t.full_name, t.first_name, t.last_name, t.linkedin_url,
           COALESCE(lta.unipile_provider_id, t.unipile_provider_id) AS unipile_provider_id,
           COALESCE(lta.unipile_chat_id, scoped_message.external_thread_id, t.unipile_chat_id) AS unipile_chat_id,
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
        ORDER BY (SELECT COUNT(*) FROM linkedin_inbox_messages c
                  WHERE c.account_id = m.account_id AND c.target_id = m.target_id
                    AND c.external_thread_id = m.external_thread_id) DESC,
                 datetime(m.sent_at) DESC, m.id DESC LIMIT 1
      )
    WHERE (
      lta.unipile_chat_id = ?
      OR t.unipile_chat_id = ?
      OR scoped_message.external_thread_id = ?
      OR (? IS NOT NULL AND (
        lta.unipile_provider_id = ? OR t.unipile_provider_id = ? OR t.messaging_urn = ?
      ))
      OR (? IS NOT NULL AND lower(t.linkedin_url) = lower(?))
    )
    ORDER BY CASE
      WHEN lta.unipile_chat_id = ? OR t.unipile_chat_id = ? OR scoped_message.external_thread_id = ? THEN 0
      WHEN lta.unipile_provider_id = ? OR t.unipile_provider_id = ? THEN 1 ELSE 2 END,
      t.created_at ASC
    LIMIT 1
  `).get(
    accountId, accountId, accountId, accountId,
    chatId, chatId, chatId,
    providerId || senderId, providerId || senderId, providerId || senderId, providerId || senderId,
    profileUrl, profileUrl,
    chatId, chatId, chatId, providerId || senderId, providerId || senderId,
  ) as LocalTarget | undefined;

  if (direct) return direct;

  // 2. Fuzzy match by Provider ID in messaging_urn (e.g. ACoAAA...)
  const effectiveId = providerId || senderId;
  if (effectiveId && effectiveId.length > 5) {
    const byUrn = db.prepare(`
      SELECT t.id, t.full_name, t.first_name, t.last_name, t.linkedin_url,
             COALESCE(lta.unipile_provider_id, t.unipile_provider_id) AS unipile_provider_id,
             COALESCE(lta.unipile_chat_id, scoped_message.external_thread_id, t.unipile_chat_id) AS unipile_chat_id,
             COALESCE(t.messaging_urn, lta.unipile_provider_id) AS messaging_urn,
             (SELECT rp.run_id FROM run_profiles rp JOIN runs r ON r.id = rp.run_id
              WHERE rp.target_id = t.id AND r.account_id = ? ORDER BY rp.created_at DESC LIMIT 1) AS run_id,
             (SELECT r.workflow_id FROM run_profiles rp JOIN runs r ON r.id = rp.run_id
              WHERE rp.target_id = t.id AND r.account_id = ? ORDER BY rp.created_at DESC LIMIT 1) AS workflow_id
      FROM targets t
      LEFT JOIN linkedin_target_accounts lta ON lta.target_id = t.id AND lta.account_id = ?
      LEFT JOIN linkedin_inbox_messages scoped_message ON scoped_message.id = (
        SELECT m.id FROM linkedin_inbox_messages m WHERE m.account_id = ? AND m.target_id = t.id
        ORDER BY datetime(m.sent_at) DESC, m.id DESC LIMIT 1
      )
      WHERE t.messaging_urn LIKE ? OR t.unipile_provider_id LIKE ? OR lta.unipile_provider_id LIKE ?
      LIMIT 1
    `).get(accountId, accountId, accountId, accountId, `%${effectiveId}%`, `%${effectiveId}%`, `%${effectiveId}%`) as LocalTarget | undefined;
    if (byUrn) return byUrn;
  }

  // 3. Match by normalized LinkedIn URL slug
  const slug = extractLinkedInSlug(profileUrl);
  if (slug && slug.length >= 3 && !slug.startsWith("acoaaa")) {
    const bySlug = db.prepare(`
      SELECT t.id, t.full_name, t.first_name, t.last_name, t.linkedin_url,
             COALESCE(lta.unipile_provider_id, t.unipile_provider_id) AS unipile_provider_id,
             COALESCE(lta.unipile_chat_id, scoped_message.external_thread_id, t.unipile_chat_id) AS unipile_chat_id,
             COALESCE(t.messaging_urn, lta.unipile_provider_id) AS messaging_urn,
             (SELECT rp.run_id FROM run_profiles rp JOIN runs r ON r.id = rp.run_id
              WHERE rp.target_id = t.id AND r.account_id = ? ORDER BY rp.created_at DESC LIMIT 1) AS run_id,
             (SELECT r.workflow_id FROM run_profiles rp JOIN runs r ON r.id = rp.run_id
              WHERE rp.target_id = t.id AND r.account_id = ? ORDER BY rp.created_at DESC LIMIT 1) AS workflow_id
      FROM targets t
      LEFT JOIN linkedin_target_accounts lta ON lta.target_id = t.id AND lta.account_id = ?
      LEFT JOIN linkedin_inbox_messages scoped_message ON scoped_message.id = (
        SELECT m.id FROM linkedin_inbox_messages m WHERE m.account_id = ? AND m.target_id = t.id
        ORDER BY datetime(m.sent_at) DESC, m.id DESC LIMIT 1
      )
      WHERE lower(t.linkedin_url) LIKE ?
      LIMIT 1
    `).get(accountId, accountId, accountId, accountId, `%${slug}%`) as LocalTarget | undefined;
    if (bySlug) return bySlug;
  }

  // 4. Match by senderName / full_name (with accent-insensitive comparison)
  if (senderName && senderName.trim().length >= 2) {
    const cleanName = normalizeName(senderName);
    const candidates = db.prepare(`
      SELECT t.id, t.full_name, t.first_name, t.last_name, t.linkedin_url,
             COALESCE(lta.unipile_provider_id, t.unipile_provider_id) AS unipile_provider_id,
             COALESCE(lta.unipile_chat_id, scoped_message.external_thread_id, t.unipile_chat_id) AS unipile_chat_id,
             COALESCE(t.messaging_urn, lta.unipile_provider_id) AS messaging_urn,
             (SELECT rp.run_id FROM run_profiles rp JOIN runs r ON r.id = rp.run_id
              WHERE rp.target_id = t.id AND r.account_id = ? ORDER BY rp.created_at DESC LIMIT 1) AS run_id,
             (SELECT r.workflow_id FROM run_profiles rp JOIN runs r ON r.id = rp.run_id
              WHERE rp.target_id = t.id AND r.account_id = ? ORDER BY rp.created_at DESC LIMIT 1) AS workflow_id
      FROM targets t
      LEFT JOIN linkedin_target_accounts lta ON lta.target_id = t.id AND lta.account_id = ?
      LEFT JOIN linkedin_inbox_messages scoped_message ON scoped_message.id = (
        SELECT m.id FROM linkedin_inbox_messages m WHERE m.account_id = ? AND m.target_id = t.id
        ORDER BY datetime(m.sent_at) DESC, m.id DESC LIMIT 1
      )
      WHERE t.full_name IS NOT NULL
      ORDER BY t.created_at DESC
      LIMIT 150
    `).all(accountId, accountId, accountId, accountId) as LocalTarget[];

    const exactMatch = candidates.find((c) => normalizeName(c.full_name) === cleanName);
    if (exactMatch) return exactMatch;
  }

  return undefined;
}

/**
 * The LinkedIn inbox must only show people tied to InHubFlow activity: someone who is
 * (or was) enrolled in a campaign, imported into a list, or contacted by a campaign run.
 * Personal LinkedIn traffic — family, recruiters, vendors, spam — must never reach it.
 *
 * Note that "we sent an outbound message" is NOT sufficient evidence on its own: a
 * provider backfill labels every message the account owner ever typed in LinkedIn as
 * `outbound`, including purely personal conversations. Only a campaign-attributed row
 * (linked to a run) proves InHubFlow originated the thread.
 *
 * `allowUnmatched` is reserved for the manual full-backfill path, where the operator
 * explicitly asks for a historical sweep; even then the caller must opt in.
 */
export interface IngestPolicy {
  allowUnmatched?: boolean;
}

function isCampaignTarget(db: Database.Database, targetId: string): boolean {
  const row = db.prepare(`
    SELECT 1 AS ok
    WHERE EXISTS (SELECT 1 FROM run_profiles rp WHERE rp.target_id = ?)
       OR EXISTS (SELECT 1 FROM list_targets lt WHERE lt.target_id = ?)
       OR EXISTS (
            SELECT 1 FROM linkedin_inbox_messages m
            WHERE m.target_id = ? AND m.direction = 'outbound' AND m.run_id IS NOT NULL
          )
       OR EXISTS (
            SELECT 1 FROM linkedin_step_deliveries d
            WHERE d.target_id = ? AND d.state IN ('sent', 'delivered')
          )
    LIMIT 1
  `).get(targetId, targetId, targetId, targetId) as { ok?: number } | undefined;
  return Boolean(row?.ok);
}

/**
 * True when a campaign (not the account owner typing in LinkedIn) previously wrote in
 * this thread — i.e. the conversation genuinely started from InHubFlow.
 */
function threadHasCampaignOutbound(db: Database.Database, accountId: string, chatId: string): boolean {
  const row = db.prepare(`
    SELECT 1 AS ok FROM linkedin_inbox_messages
    WHERE account_id = ? AND external_thread_id = ? AND direction = 'outbound' AND run_id IS NOT NULL
    LIMIT 1
  `).get(accountId, chatId) as { ok?: number } | undefined;
  return Boolean(row?.ok);
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
    policy?: IngestPolicy;
  },
): Promise<{ captured: boolean; targetId: string | null; direction: "inbound" | "outbound"; skipped?: string }> {
  const message = input.message;
  const messageId = String(message.message_id || message.id || "").trim();
  const chatId = String(message.chat_id || "").trim();
  if (!messageId || !chatId) throw new Error("Evento de mensaje de LinkedIn incompleto");
  const direction = message.is_sender === true || message.is_sender === 1 ? "outbound" : "inbound";
  const profile = input.profile || { providerId: message.sender_id || null, name: null, profileUrl: null, memberUrn: null };
  let target = targetForMessage(db, input.localAccountId, chatId, message.sender_id || null, profile.profileUrl, profile.providerId, profile.name);

  // Gate: only InHubFlow-related conversations belong in the inbox. A contact with no
  // campaign/list tie and no campaign-attributed outbound is personal LinkedIn traffic.
  if (!target || !isCampaignTarget(db, target.id)) {
    const isOurs = threadHasCampaignOutbound(db, input.localAccountId, chatId);
    if (!isOurs && !input.policy?.allowUnmatched) {
      return { captured: false, targetId: target?.id ?? null, direction, skipped: "not_campaign_related" };
    }
  }

  // If no existing target matched, auto-create a contact so messages are never dropped
  if (!target) {
    const newTargetId = randomUUID();
    const effectiveId = profile.providerId || message.sender_id || null;
    const displayName = profile.name || "Contacto LinkedIn";
    const nameParts = displayName.trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";
    const linkedinUrl = profile.profileUrl || (effectiveId ? `https://www.linkedin.com/in/${effectiveId}` : null);

    db.prepare(`
      INSERT INTO targets (
        id, full_name, first_name, last_name, linkedin_url,
        unipile_provider_id, unipile_chat_id, last_replied_account_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      newTargetId, displayName, firstName, lastName, linkedinUrl,
      effectiveId, chatId, input.localAccountId,
    );

    ensureLinkedInTargetAccountState(db, input.localAccountId, {
      id: newTargetId,
      unipile_provider_id: effectiveId,
      unipile_chat_id: chatId,
    });

    target = {
      id: newTargetId,
      full_name: displayName,
      first_name: firstName,
      last_name: lastName,
      linkedin_url: linkedinUrl,
      messaging_urn: effectiveId,
      unipile_provider_id: effectiveId,
      unipile_chat_id: chatId,
    };
  }

  // Ensure target and target-account have the unipile_chat_id and unipile_provider_id updated
  const effectiveProviderId = profile.providerId || message.sender_id || null;
  db.prepare(`
    UPDATE targets
    SET unipile_chat_id = COALESCE(unipile_chat_id, ?),
        unipile_provider_id = COALESCE(unipile_provider_id, ?)
    WHERE id = ?
  `).run(chatId, effectiveProviderId, target.id);

  markLinkedInTargetState(db, input.localAccountId, target.id, {
    unipile_chat_id: chatId,
    ...(effectiveProviderId ? { unipile_provider_id: effectiveProviderId } : {}),
  });

  const sentAt = message.timestamp && !Number.isNaN(Date.parse(message.timestamp)) ? new Date(message.timestamp).toISOString() : new Date().toISOString();
  const text = String(message.text || "").trim();
  if (!text && (!message.attachments || message.attachments.length === 0)) return { captured: false, targetId: target.id, direction };
  const body = text || "[Archivo adjunto]";
  const metadata = JSON.stringify({ source: input.source || "linkedin-cloud", attachments: message.attachments || [] });
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

  if (direction === "inbound") {
    db.prepare("UPDATE targets SET last_replied_at = ?, last_replied_account_id = ? WHERE id = ?").run(sentAt, input.localAccountId, target.id);
    // A reply moves the lead into conversation without waiting for the SDR:
    // the SDR enriches the stage afterwards with its intent tags.
    try {
      applyTag(db, target.id, "replied", {
        source: "rule",
        runId,
        appliedBy: "inbox",
        reason: "Respondió por LinkedIn",
      });
    } catch {
      // Non-blocking pipeline tag
    }
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

export async function syncLinkedInInbox(
  db: Database.Database,
  localAccountId: string,
  client: UnipileClient = unipile,
  options: { maxMessages?: number; maxChats?: number; fullBackfill?: boolean } = {},
): Promise<InboxSyncResult> {
  const resolved = await resolveUnipileAccount(db, localAccountId, client);
  // A single page of account-wide messages only covers a handful of the oldest-active
  // chats (11 of 250 in production), so replies in any other thread were never seen.
  // Page through the global feed until we stop getting new data or hit the cap.
  const maxMessages = options.maxMessages ?? 500;
  const maxChats = options.maxChats ?? 100;
  // The paginated account feed already covers every chat (264 of 264 in production),
  // so the slower chat-by-chat sweep is opt-in rather than part of every tick.
  const fullBackfill = options.fullBackfill ?? false;

  let captured = 0;
  let duplicates = 0;
  let createdTargets = 0;
  const chatsSeen = new Set<string>();

  // 1. Walk the account-wide message feed with cursor pagination
  let remoteMessages: UnipileMessage[] = [];
  try {
    let cursor: string | null | undefined = undefined;
    let guard = 0;
    while (guard++ < 20) {
      const res = await client.listAccountMessages(resolved.unipileAccountId, Math.min(250, maxMessages), cursor ?? undefined);
      const batch = res.items || [];
      remoteMessages.push(...batch);
      if (batch.length === 0) break;
      if (remoteMessages.length >= maxMessages) break;
      const next = res.cursor;
      if (!next || next === cursor) break;
      cursor = next;
    }
  } catch (err) {
    console.warn("[syncLinkedInInbox] Error fetching account messages, fallback to chats:", err);
  }

  // Cache attendee profiles by chatId to prevent redundant network calls
  const chatAttendeeCache = new Map<string, { providerId: string | null; name: string | null; profileUrl: string | null; memberUrn: string | null }>();

  for (const message of remoteMessages) {
    const chatId = message.chat_id;
    if (!chatId) continue;
    chatsSeen.add(chatId);

    const messageId = message.id || message.message_id;
    const before = db.prepare(
      "SELECT 1 FROM linkedin_inbox_messages WHERE account_id = ? AND external_thread_id = ? AND external_message_id = ?"
    ).get(localAccountId, chatId, messageId);

    if (!chatAttendeeCache.has(chatId)) {
      let profile = { providerId: message.sender_id || null, name: null as string | null, profileUrl: null as string | null, memberUrn: null as string | null };
      const existing = targetForMessage(db, localAccountId, chatId, message.sender_id || null, null, message.sender_id || null);
      if (existing) {
        profile = {
          providerId: existing.unipile_provider_id || message.sender_id || null,
          name: existing.full_name || null,
          profileUrl: existing.linkedin_url || null,
          memberUrn: existing.messaging_urn || null,
        };
      } else {
        try {
          const attRes = await client.listChatAttendees(chatId);
          const other = (attRes.items || []).find((a) => !a.is_self) || attRes.items?.[0];
          if (other) {
            profile = attendeeProfile(other);
          }
        } catch { /* ignore attendee error */ }
      }
      chatAttendeeCache.set(chatId, profile);
    }

    const profile = chatAttendeeCache.get(chatId)!;
    const result = await ingestUnipileMessage(db, {
      localAccountId,
      message: { ...message, chat_id: chatId },
      profile,
      source: "linkedin-sync",
    });

    if (result.captured) captured++;
    else if (before) duplicates++;
  }

  // 2. Sweep the chat list so threads missed by the global feed are still ingested.
  //    The old version only looked at 15 chats *with unread messages*, so any thread
  //    that had been read elsewhere never got its history imported.
  let totalChatsCount = chatsSeen.size;
  try {
    const chatsResponse = await client.listChats(resolved.unipileAccountId, Math.min(250, maxChats));
    const chats = chatsResponse.items || [];
    totalChatsCount = Math.max(totalChatsCount, chats.length);

    for (const chat of chats) {
      if (chatsSeen.has(chat.id)) continue;
      if (!fullBackfill && (chat.unread_count ?? 0) === 0) continue;
      try {
        const attendeesResponse = await client.listChatAttendees(chat.id);
        const other = (attendeesResponse.items || []).find((attendee) => !attendee.is_self);
        const profile = attendeeProfile(other);
        chatAttendeeCache.set(chat.id, profile);

        const messagesResponse = await client.listMessages(chat.id, 100);
        for (const message of messagesResponse.items || []) {
          const before = db.prepare(
            "SELECT 1 FROM linkedin_inbox_messages WHERE account_id = ? AND external_thread_id = ? AND external_message_id = ?"
          ).get(localAccountId, chat.id, message.id || message.message_id);
          const result = await ingestUnipileMessage(db, {
            localAccountId,
            message: { ...message, chat_id: chat.id },
            profile,
            source: "linkedin-sync",
          });
          if (result.captured) captured++;
          else if (before) duplicates++;
        }
        chatsSeen.add(chat.id);
      } catch { /* skip */ }
    }
  } catch (err) {
    console.warn("[syncLinkedInInbox] Error checking additional chats:", err);
  }

  db.prepare(
    "UPDATE accounts SET linkedin_inbox_synced_at = datetime('now'), linkedin_inbox_sync_error = NULL, unipile_status = COALESCE(unipile_status, 'OK') WHERE id = ?",
  ).run(localAccountId);

  return {
    chats: totalChatsCount,
    messages: captured,
    duplicates,
    createdTargets,
    accountId: localAccountId,
    providerAccountId: resolved.unipileAccountId,
  };
}

export function markInboxSyncError(db: Database.Database, accountId: string, error: unknown): void {
  db.prepare("UPDATE accounts SET linkedin_inbox_sync_error = ? WHERE id = ?").run(error instanceof Error ? error.message : String(error), accountId);
}

export { attendeeProfile, normalizeName as normalize, normalizeName };
