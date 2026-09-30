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
    const workflows = db
      .prepare(
        `SELECT w.*, COUNT(ws.id) as step_count
         FROM workflows w
         LEFT JOIN workflow_steps ws ON ws.workflow_id = w.id
         GROUP BY w.id
         ORDER BY w.created_at DESC`
      )
      .all();
    return res.json(workflows);
  }

  if (req.method === "POST") {
    const { name, description, prompt } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const id = randomUUID();
    db.prepare("INSERT INTO workflows (id, name, description, prompt) VALUES (?, ?, ?, ?)").run(id, name, description ?? null, prompt ?? null);
    return res.status(201).json(db.prepare("SELECT * FROM workflows WHERE id = ?").get(id));
  }

  res.status(405).end();
}
