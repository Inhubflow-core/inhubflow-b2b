import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { importCsv } from "@/lib/csv-import";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const db = getDb();
  const listId = req.query.id as string;

  const list = db.prepare("SELECT id FROM lists WHERE id = ?").get(listId) as { id: string } | undefined;
  if (!list) return res.status(404).json({ error: "List not found" });

  const { csv } = req.body as { csv?: string };
  if (!csv || typeof csv !== "string" || !csv.trim()) {
    return res.status(400).json({ error: "csv content is required" });
  }

  // Derive workspaceOwnerId from list or accounts
  const listOwner = (db.prepare(`
    SELECT a.owner_id
    FROM lists l
    LEFT JOIN runs r ON r.list_id = l.id
    LEFT JOIN accounts a ON a.id = r.account_id
    WHERE l.id = ? AND a.owner_id IS NOT NULL
    LIMIT 1
  `).get(listId) as { owner_id: string } | undefined)?.owner_id;

  const result = importCsv(db, listId, csv, listOwner);
  res.json(result);
}
