import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const db = getDb();
  const id = req.query.id as string;

  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
  if (!account) return res.status(404).json({ error: "Account not found" });

  const { unipile_account_id } = req.body || {};

  db.prepare(`
    UPDATE accounts SET
      unipile_account_id = COALESCE(?, unipile_account_id),
      unipile_status = 'OK',
      is_authenticated = 1
    WHERE id = ?
  `).run(unipile_account_id || null, id);

  return res.json({ success: true, message: "Cuenta autenticada vía Unipile" });
}
