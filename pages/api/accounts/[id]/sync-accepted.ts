import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const accountId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!accountId) return res.status(400).json({ error: "Missing account id" });

  const db = getDb();
  const account = db.prepare("SELECT id, name FROM accounts WHERE id = ?").get(accountId);
  if (!account) return res.status(404).json({ error: "Account not found" });

  try {
    // Con Unipile, las conexiones aceptadas se sincronizan vía Webhook (invitation_accepted)
    // o al recibir mensajes. Verificamos el estado en base de datos.
    const connectedTargets = (db.prepare(`
      SELECT COUNT(*) as count FROM targets WHERE degree = 1
    `).get() as { count: number }).count;

    return res.json({
      ok: true,
      success: true,
      stamped: 0,
      connectionsRead: connectedTargets,
      newly_accepted: 0,
      message: "Sincronización gestionada en tiempo real vía Webhooks de Unipile",
    });
  } catch (err) {
    console.error("[sync-accepted]", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Sync failed" });
  }
}

export const config = {
  api: { responseLimit: false },
};
