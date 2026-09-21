import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { unipile } from "@/lib/unipile/client";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import { requireApiActor } from "@/lib/authz";

/**
 * POST /api/targets/sync-photos
 * Syncs / extracts LinkedIn profile photos for targets that currently lack one.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
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

  const { target_id, limit = 10 } = req.body || {};
  let targetsToSync: Array<{ id: string; linkedin_url: string; full_name: string | null }>;

  if (target_id) {
    const single = db.prepare("SELECT id, linkedin_url, full_name FROM targets WHERE id = ?").get(target_id) as { id: string; linkedin_url: string; full_name: string | null } | undefined;
    targetsToSync = single ? [single] : [];
  } else {
    targetsToSync = db.prepare(
      `SELECT id, linkedin_url, full_name
       FROM targets
       WHERE (profile_image_url IS NULL OR profile_image_url = '')
         AND linkedin_url IS NOT NULL AND linkedin_url != ''
       LIMIT ?`
    ).all(Number(limit)) as Array<{ id: string; linkedin_url: string; full_name: string | null }>;
  }

  if (targetsToSync.length === 0) {
    return res.json({ synced: 0, message: "Todos los prospectos ya tienen foto o no tienen URL de LinkedIn" });
  }

  let resolvedAccount;
  try {
    resolvedAccount = await resolveUnipileAccount(db, account.id, unipile);
  } catch (err) {
    return res.status(500).json({ error: "Error resolviendo cuenta de LinkedIn: " + (err instanceof Error ? err.message : String(err)) });
  }

  let updatedCount = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const t of targetsToSync) {
    try {
      // Jitter delay to protect LinkedIn account
      await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 400)));
      const profile = await unipile.resolveProfile(t.linkedin_url, resolvedAccount.unipileAccountId);
      const photoUrl =
        profile.profile_picture_url_large ||
        profile.profile_picture_url ||
        ((profile as unknown as { picture_url?: string }).picture_url ?? null);

      if (photoUrl) {
        db.prepare(
          "UPDATE targets SET profile_image_url = ?, headline = COALESCE(?, headline) WHERE id = ?"
        ).run(photoUrl, profile.headline || null, t.id);
        updatedCount++;
      }
    } catch (err) {
      errors.push({ id: t.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return res.json({
    synced: updatedCount,
    totalAttempted: targetsToSync.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
