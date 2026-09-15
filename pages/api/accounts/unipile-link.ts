import type { NextApiRequest, NextApiResponse } from "next";
import { unipile } from "@/lib/unipile/client";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { createHostedAuthState } from "@/lib/unipile/callback-state";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  if (!unipile.isConfigured()) {
    return res.status(503).json({
      error: "Unipile no está configurado en el servidor. Por favor define UNIPILE_DSN y UNIPILE_API_KEY.",
    });
  }

  try {
    const { accountId, name, successUrl, failureUrl } = req.body as {
      accountId?: string;
      name?: string;
      successUrl?: string;
      failureUrl?: string;
    };
    const db = getDb();
    if (!accountId) return res.status(400).json({ error: "accountId es obligatorio" });
    const localAccount = db.prepare("SELECT id, unipile_account_id FROM accounts WHERE id = ?").get(accountId) as { id: string; unipile_account_id?: string | null } | undefined;
    if (!localAccount || !canAccessLinkedInAccount(db, actor, accountId)) return res.status(404).json({ error: "Cuenta local no encontrada" });

    const host = req.headers.host || "localhost:3000";
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const baseUrl = `${protocol}://${host}`;
    const secret = (process.env.UNIPILE_CALLBACK_SECRET || process.env.UNIPILE_WEBHOOK_SECRET)?.trim();
    if (!secret) return res.status(503).json({ error: "UNIPILE_CALLBACK_SECRET no está configurado" });
    const state = createHostedAuthState(accountId, secret);
    const callbackUrl = `${baseUrl}/api/accounts/unipile-callback?state=${encodeURIComponent(state)}`;
    const linkResponse = await unipile.getHostedAuthLink({
      type: localAccount.unipile_account_id ? "reconnect" : "create",
      reconnect_account: localAccount.unipile_account_id || undefined,
      providers: ["LINKEDIN"],
      name: accountId,
      success_redirect_url: successUrl || `${baseUrl}/settings?unipile_status=success`,
      failure_redirect_url: failureUrl || `${baseUrl}/settings?unipile_status=error`,
      notify_url: callbackUrl,
    });

    return res.status(200).json({ url: linkResponse.url, accountId, displayName: name || null });
  } catch (error) {
    console.error("[pages/api/accounts/unipile-link] Error generando link de Unipile:", error);
    return res.status(500).json({
      error: "No se pudo generar el enlace de conexión de Unipile",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
