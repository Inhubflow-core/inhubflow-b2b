import type { NextApiRequest, NextApiResponse } from "next";
import { getDb, getDemoDb, cleanDemoDataFromMainDb } from "@/lib/db";
import { randomUUID } from "crypto";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const isDemo = (session?.user as any)?.email?.trim().toLowerCase() === "demo@inhubflow.com";
  const db = isDemo ? getDemoDb() : getDb();
  const ownerId = (session?.user as any)?.id || null;

  if (!isDemo) {
    cleanDemoDataFromMainDb(db);
  }

  if (req.method === "GET") {
    const filterDemoClause = isDemo ? "" : "AND w.id NOT LIKE 'demo_%'";
    return res.json(db.prepare(`
      SELECT w.*, COUNT(ws.id) as step_count FROM workflows w
      LEFT JOIN workflow_steps ws ON ws.workflow_id = w.id
      WHERE (? IS NULL OR w.owner_id = ? OR w.owner_id IS NULL)
      ${filterDemoClause}
      GROUP BY w.id ORDER BY w.created_at DESC
    `).all(ownerId, ownerId));
  }
  if (req.method === "POST") {
    const { name, description, prompt } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const id = randomUUID();
    db.prepare("INSERT INTO workflows (id, name, description, prompt, owner_id) VALUES (?, ?, ?, ?, ?)").run(id, name, description ?? null, prompt ?? null, ownerId);
    return res.status(201).json(db.prepare("SELECT * FROM workflows WHERE id = ?").get(id));
  }
  res.status(405).end();
}
