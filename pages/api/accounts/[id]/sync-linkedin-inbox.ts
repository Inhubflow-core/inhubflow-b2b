import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { syncLinkedInInbox, markInboxSyncError } from "@/lib/unipile/inbox-sync";
import { unipile } from "@/lib/unipile/client";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const accountId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!accountId) return res.status(400).json({ error: "Missing account id" });

  const db = getDb();
  if (!canAccessLinkedInAccount(db, actor, accountId)) return res.status(404).json({ error: "LinkedIn account not found" });
  if (!unipile.isConfigured()) return res.status(503).json({ error: "El motor de LinkedIn no está configurado" });

  try {
    const result = await syncLinkedInInbox(db, accountId, unipile, { maxMessages: 500, fullBackfill: true });
    return res.status(200).json({ ok: true, ...result, source: "linkedin-cloud" });
  } catch (error) {
    markInboxSyncError(db, accountId, error);
    console.error("[sync-linkedin-inbox] Error sincronizando el inbox cloud:", error);
    return res.status(502).json({ error: error instanceof Error ? error.message : "Error sincronizando el inbox de LinkedIn" });
  }
}

export const config = { api: { responseLimit: false } };
