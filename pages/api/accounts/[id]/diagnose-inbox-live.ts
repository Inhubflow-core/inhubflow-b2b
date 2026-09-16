import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { unipile } from "@/lib/unipile/client";
import { accountStatus } from "@/lib/unipile/account";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const accountId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!accountId) return res.status(400).json({ error: "Missing account id" });

  const db = getDb();
  if (!canAccessLinkedInAccount(db, actor, accountId)) return res.status(404).json({ error: "LinkedIn account not found" });
  const account = db.prepare(`SELECT id, name, email, is_authenticated, unipile_account_id, unipile_status, linkedin_inbox_synced_at, linkedin_inbox_sync_error FROM accounts WHERE id = ?`).get(accountId) as {
    id: string;
    name: string | null;
    email: string;
    is_authenticated: number;
    unipile_account_id: string | null;
    unipile_status: string | null;
    linkedin_inbox_synced_at: string | null;
    linkedin_inbox_sync_error: string | null;
  } | undefined;
  if (!account) return res.status(404).json({ error: "LinkedIn account not found" });

  const publicAccount = {
    name: account.name,
    email: account.email,
    is_authenticated: account.is_authenticated,
    linkedin_connection_status: account.unipile_status,
    linkedin_inbox_synced_at: account.linkedin_inbox_synced_at,
    linkedin_inbox_sync_error: account.linkedin_inbox_sync_error,
  };

  let remote = null;
  if (unipile.isConfigured() && account.unipile_account_id) {
    try {
      remote = await unipile.getAccount(account.unipile_account_id);
      const status = accountStatus(remote);
      db.prepare("UPDATE accounts SET unipile_status = ?, is_authenticated = ? WHERE id = ?").run(status, status === "OK" ? 1 : 0, accountId);
    } catch (error) {
      console.error("[diagnose-linkedin-inbox] Error consultando el motor de LinkedIn:", error);
      return res.status(502).json({ ok: false, account: publicAccount, error: "No se pudo consultar el estado de la cuenta de LinkedIn" });
    }
  }

  return res.status(200).json({
    ok: true,
    account: publicAccount,
    connection: remote ? { name: remote.name, status: accountStatus(remote) } : null,
  });
}
