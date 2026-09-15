import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { unipile } from "@/lib/unipile/client";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import { markLinkedInTargetState } from "@/lib/linkedin/account-state";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const db = getDb();
  const id = req.query.id as string;
  const target = db.prepare(
    "SELECT id, full_name, linkedin_url FROM targets WHERE id = ?"
  ).get(id) as { id: string; full_name: string | null; linkedin_url: string | null } | undefined;

  if (!target) return res.status(404).json({ error: "Contact not found" });
  if (!target.linkedin_url) {
    return res.status(400).json({ error: "Contact has no LinkedIn URL" });
  }

  const account = db.prepare(
    "SELECT id, unipile_account_id FROM accounts WHERE is_authenticated = 1 LIMIT 1"
  ).get() as { id: string; unipile_account_id?: string | null } | undefined;

  if (!account) return res.status(400).json({ error: "No authenticated LinkedIn account found" });

  try {
    if (!unipile.isConfigured()) {
      return res.status(503).json({ error: "Unipile is not configured" });
    }

    const resolved = await resolveUnipileAccount(db, account.id, unipile);
    const profile = await unipile.resolveProfile(target.linkedin_url, resolved.unipileAccountId);

    db.prepare(`
      UPDATE targets SET headline = COALESCE(?, headline) WHERE id = ?
    `).run(profile.headline, id);
    markLinkedInTargetState(db, account.id, id, {
      unipile_provider_id: profile.provider_id,
    });

    return res.json({ contact_id: id, account_id: account.id, profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}
