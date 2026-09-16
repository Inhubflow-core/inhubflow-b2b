import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { unipile } from "@/lib/unipile/client";
import { accountStatus } from "@/lib/unipile/account";
import { verifyHostedAuthState } from "@/lib/unipile/callback-state";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const secret = (process.env.UNIPILE_CALLBACK_SECRET || process.env.UNIPILE_WEBHOOK_SECRET)?.trim();
  if (!secret) return res.status(503).json({ error: "La conexión segura de LinkedIn no está configurada" });
  const token = typeof req.query.state === "string" ? req.query.state : "";
  const state = verifyHostedAuthState(token, secret);
  if (!state) return res.status(401).json({ error: "Estado de callback inválido o vencido" });

  const { status, account_id: remoteAccountId, name } = req.body || {};
  if (!["CREATION_SUCCESS", "RECONNECTED"].includes(String(status)) || !remoteAccountId || name !== state.accountId) {
    return res.status(400).json({ error: "Callback de Hosted Auth incompleto" });
  }

  try {
    const remote = await unipile.getAccount(remoteAccountId);
    if (String(remote.type || remote.provider).toUpperCase() !== "LINKEDIN") {
      return res.status(400).json({ error: "La cuenta conectada no es de LinkedIn" });
    }
    const remoteStatus = accountStatus(remote) || String(status);
    const db = getDb();
    const update = db.prepare(`
      UPDATE accounts SET unipile_account_id = ?, unipile_status = ?, is_authenticated = ? WHERE id = ?
    `).run(remoteAccountId, remoteStatus, remoteStatus === "OK" ? 1 : 0, state.accountId);
    if (update.changes === 0) return res.status(404).json({ error: "Cuenta local no encontrada" });
    return res.status(200).json({ received: true, accountId: state.accountId, providerAccountId: remoteAccountId, status: remoteStatus });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "No se pudo verificar la cuenta de LinkedIn" });
  }
}
