import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { unipile } from "@/lib/unipile/client";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import { requireApiActor } from "@/lib/authz";

/**
 * /api/targets/sync-photos
 * Syncs / extracts LinkedIn profile photos for targets and signal_leads that lack one.
 * Supports POST and GET.
 * Accepts:
 * - target_id (string)
 * - target_ids (string[])
 * - list_id (string)
 * - signal_lead_ids (string[])
 * - monitor_id (string)
 * - limit (number, default 25)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", ["POST", "GET"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const db = getDb();
  const account = db.prepare(
    "SELECT id, unipile_account_id FROM accounts WHERE is_authenticated = 1 LIMIT 1"
  ).get() as { id: string; unipile_account_id?: string | null } | undefined;

  if (!account || !unipile.isConfigured()) {
    return res.status(503).json({ error: "LinkedIn engine not configured or no authenticated account" });
  }

  const body = req.method === "POST" ? req.body || {} : req.query || {};
  const {
    target_id,
    target_ids,
    list_id,
    signal_lead_ids,
    monitor_id,
    limit = 25,
  } = body;

  let resolvedAccount;
  try {
    resolvedAccount = await resolveUnipileAccount(db, account.id, unipile);
  } catch (err) {
    return res.status(500).json({ error: "Error resolviendo cuenta de LinkedIn: " + (err instanceof Error ? err.message : String(err)) });
  }

  const updated: Record<string, string> = {};
  let syncedCount = 0;

  // 1. Sync targets
  let targetsToSync: Array<{
    id: string;
    linkedin_url: string | null;
    unipile_chat_id: string | null;
    unipile_provider_id: string | null;
    full_name: string | null;
  }> = [];

  if (target_id) {
    const single = db.prepare(
      "SELECT id, linkedin_url, unipile_chat_id, unipile_provider_id, full_name FROM targets WHERE id = ?"
    ).get(target_id) as typeof targetsToSync[number] | undefined;
    if (single) targetsToSync.push(single);
  } else if (Array.isArray(target_ids) && target_ids.length > 0) {
    const placeholders = target_ids.map(() => "?").join(",");
    targetsToSync = db.prepare(
      `SELECT id, linkedin_url, unipile_chat_id, unipile_provider_id, full_name
       FROM targets
       WHERE id IN (${placeholders})
         AND (profile_image_url IS NULL OR profile_image_url = '')`
    ).all(...target_ids) as typeof targetsToSync;
  } else if (list_id) {
    targetsToSync = db.prepare(
      `SELECT t.id, t.linkedin_url, t.unipile_chat_id, t.unipile_provider_id, t.full_name
       FROM targets t
       JOIN list_targets lt ON lt.target_id = t.id
       WHERE lt.list_id = ?
         AND (t.profile_image_url IS NULL OR t.profile_image_url = '')
         AND (t.linkedin_url IS NOT NULL OR t.unipile_chat_id IS NOT NULL)
       LIMIT ?`
    ).all(list_id, Number(limit)) as typeof targetsToSync;
  } else if (!signal_lead_ids && !monitor_id) {
    targetsToSync = db.prepare(
      `SELECT id, linkedin_url, unipile_chat_id, unipile_provider_id, full_name
       FROM targets
       WHERE (profile_image_url IS NULL OR profile_image_url = '')
         AND (linkedin_url IS NOT NULL OR unipile_chat_id IS NOT NULL)
       ORDER BY last_replied_at DESC NULLS LAST, created_at DESC
       LIMIT ?`
    ).all(Number(limit)) as typeof targetsToSync;
  }

  for (const t of targetsToSync) {
    try {
      let photoUrl: string | null = null;

      // Priority 1: Fast & free chat attendee lookup if chat_id exists
      if (t.unipile_chat_id) {
        try {
          const attendees = await unipile.listChatAttendees(t.unipile_chat_id);
          const other = (attendees.items || []).find((a) => !a.is_self) || attendees.items?.[0];
          if (other?.picture_url) {
            photoUrl = other.picture_url;
          }
        } catch {
          // Fall back to profile resolution
        }
      }

      // Priority 2: Resolve profile via LinkedIn identifier / URL
      const identifier = t.linkedin_url || t.unipile_provider_id;
      if (!photoUrl && identifier) {
        // Jitter to protect account
        await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 250)));
        const profile = await unipile.resolveProfile(identifier, resolvedAccount.unipileAccountId);
        photoUrl =
          profile.profile_picture_url_large ||
          profile.profile_picture_url ||
          ((profile as unknown as { picture_url?: string }).picture_url ?? null);
      }

      if (photoUrl) {
        db.prepare(
          "UPDATE targets SET profile_image_url = ? WHERE id = ?"
        ).run(photoUrl, t.id);
        updated[t.id] = photoUrl;
        syncedCount++;
      }
    } catch (err) {
      console.warn(`[sync-photos] Could not sync photo for target ${t.id}:`, err instanceof Error ? err.message : String(err));
    }
  }

  // 2. Sync signal_leads if requested
  let signalLeadsToSync: Array<{ id: string; linkedin_url: string | null; provider_id: string | null }> = [];
  if (Array.isArray(signal_lead_ids) && signal_lead_ids.length > 0) {
    const placeholders = signal_lead_ids.map(() => "?").join(",");
    signalLeadsToSync = db.prepare(
      `SELECT id, linkedin_url, provider_id
       FROM signal_leads
       WHERE id IN (${placeholders})
         AND (profile_image_url IS NULL OR profile_image_url = '')
         AND linkedin_url IS NOT NULL`
    ).all(...signal_lead_ids) as typeof signalLeadsToSync;
  } else if (monitor_id) {
    signalLeadsToSync = db.prepare(
      `SELECT id, linkedin_url, provider_id
       FROM signal_leads
       WHERE monitor_id = ?
         AND (profile_image_url IS NULL OR profile_image_url = '')
         AND linkedin_url IS NOT NULL
       LIMIT ?`
    ).all(monitor_id, Number(limit)) as typeof signalLeadsToSync;
  }

  for (const sl of signalLeadsToSync) {
    try {
      const identifier = sl.linkedin_url || sl.provider_id;
      if (!identifier) continue;
      await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 250)));
      const profile = await unipile.resolveProfile(identifier, resolvedAccount.unipileAccountId);
      const photoUrl =
        profile.profile_picture_url_large ||
        profile.profile_picture_url ||
        ((profile as unknown as { picture_url?: string }).picture_url ?? null);

      if (photoUrl) {
        db.prepare("UPDATE signal_leads SET profile_image_url = ? WHERE id = ?").run(photoUrl, sl.id);
        updated[sl.id] = photoUrl;
        syncedCount++;
      }
    } catch (err) {
      console.warn(`[sync-photos] Could not sync photo for signal_lead ${sl.id}:`, err instanceof Error ? err.message : String(err));
    }
  }

  return res.json({
    success: true,
    synced: syncedCount,
    updated,
  });
}
