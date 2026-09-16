import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const db = getDb();
  const id = req.query.id as string;
  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
  if (!account) return res.status(404).json({ error: "Account not found" });

  return res.json({
    status: "use_linkedin_cloud",
    message: "Utiliza el enlace seguro para conectar tu cuenta de LinkedIn.",
  });
}
