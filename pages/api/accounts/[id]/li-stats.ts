import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const accountId = req.query.id as string;
  const db = getDb();
  const account = db.prepare("SELECT id, is_authenticated FROM accounts WHERE id = ?").get(accountId) as
    | { id: string; is_authenticated: number }
    | undefined;

  if (!account) return res.status(404).json({ error: "Account not found" });

  try {
    // Contar conexiones activas y mensajes enviados de esta cuenta en la base de datos
    const connectionsCount = (db.prepare(`
      SELECT COUNT(*) as count FROM targets WHERE degree = 1
    `).get() as { count: number }).count;

    const pendingCount = (db.prepare(`
      SELECT COUNT(*) as count FROM targets WHERE connection_requested_at IS NOT NULL AND connected_at IS NULL
    `).get() as { count: number }).count;

    const messagesSentCount = (db.prepare(`
      SELECT COUNT(*) as count FROM linkedin_inbox_messages WHERE account_id = ? AND direction = 'outbound'
    `).get(accountId) as { count: number }).count;

    const stats = {
      connections: connectionsCount,
      pending: pendingCount,
      profile_views: messagesSentCount,
    };

    db.prepare(`
      UPDATE accounts SET
        li_connections = ?, li_pending = ?, li_profile_views = ?,
        li_stats_synced_at = datetime('now')
      WHERE id = ?
    `).run(stats.connections, stats.pending, stats.profile_views, accountId);

    return res.json(stats);
  } catch (err) {
    console.error("[li-stats]", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Calculation failed" });
  }
}
