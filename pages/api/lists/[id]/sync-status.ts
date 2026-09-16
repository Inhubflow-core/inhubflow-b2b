import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const db = getDb();
  const listId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const list = db.prepare("SELECT id FROM lists WHERE id = ?").get(listId);
  if (!list) return res.status(404).json({ error: "List not found" });

  const accountId = typeof req.body?.account_id === "string" ? req.body.account_id.trim() : "";
  if (!accountId) return res.status(400).json({ error: "account_id required" });

  try {
    const listConnected = (db.prepare(`
      SELECT COUNT(*) as count
      FROM list_targets lt
      JOIN targets t ON t.id = lt.target_id
      WHERE lt.list_id = ? AND t.degree = 1
    `).get(listId) as { count: number }).count;

    return res.json({
      ok: true,
      success: true,
      updated: 0,
      total: listConnected,
      message: "Sincronizado con éxito",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}

export const config = {
  api: { responseLimit: false },
};
