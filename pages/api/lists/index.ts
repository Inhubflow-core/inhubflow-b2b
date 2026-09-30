import type { NextApiRequest, NextApiResponse } from "next";
import { getDb, getDemoDb } from "@/lib/db";
import { randomUUID } from "crypto";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const isDemo = (session?.user as any)?.email?.trim().toLowerCase() === "demo@inhubflow.com";
  const db = isDemo ? getDemoDb() : getDb();

  if (req.method === "GET") {
    const lists = db
      .prepare(
        `SELECT l.*, COUNT(lt.target_id) as target_count
         FROM lists l
         LEFT JOIN list_targets lt ON lt.list_id = l.id
         GROUP BY l.id
         ORDER BY l.created_at DESC`
      )
      .all();
    return res.json(lists);
  }

  if (req.method === "POST") {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const id = randomUUID();
    db
      .prepare("INSERT INTO lists (id, name, description) VALUES (?, ?, ?)")
      .run(id, name, description ?? null);
    return res.status(201).json(db.prepare("SELECT * FROM lists WHERE id = ?").get(id));
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end();
}
