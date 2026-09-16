import type { NextApiRequest, NextApiResponse } from "next";
import { unipile } from "@/lib/unipile/client";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido. Usa POST." });
  }

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  if (!unipile.isConfigured()) {
    return res.status(503).json({
      error: "El servicio de conexión no está configurado en el servidor.",
    });
  }

  const { accountId, username, password } = req.body as {
    accountId?: string;
    username?: string;
    password?: string;
  };

  if (!accountId || !username?.trim() || !password) {
    return res.status(400).json({
      error: "Por favor proporciona la cuenta, el correo o teléfono y la contraseña de LinkedIn.",
    });
  }

  try {
    const db = getDb();
    const localAccount = db
      .prepare("SELECT id, name, email, unipile_account_id FROM accounts WHERE id = ?")
      .get(accountId) as { id: string; name: string; email: string; unipile_account_id?: string | null } | undefined;

    if (!localAccount || !canAccessLinkedInAccount(db, actor, accountId)) {
      return res.status(404).json({ error: "Cuenta no encontrada o sin permisos de acceso" });
    }

    // Iniciar login directo en LinkedIn
    const authRes = await unipile.startCredentialsAuth({
      username: username.trim(),
      password,
      name: accountId,
    });

    // Caso 1: Checkpoint / 2FA requerido por LinkedIn (Status 202)
    if (authRes.object === "Checkpoint" || authRes.checkpoint) {
      const remoteAccountId = authRes.account_id || authRes.id;
      if (remoteAccountId) {
        db.prepare(
          "UPDATE accounts SET unipile_account_id = ?, unipile_status = 'CHECKPOINT' WHERE id = ?"
        ).run(remoteAccountId, accountId);
      }

      return res.status(200).json({
        success: true,
        checkpoint: true,
        checkpointType: authRes.checkpoint?.type || "2FA",
        remoteAccountId,
        accountId,
      });
    }

    // Caso 2: Login directo exitoso
    const remoteId = authRes.id || authRes.account_id;
    if (remoteId) {
      db.prepare(`
        UPDATE accounts 
        SET unipile_account_id = ?, unipile_status = 'OK', is_authenticated = 1 
        WHERE id = ?
      `).run(remoteId, accountId);
    }

    return res.status(200).json({
      success: true,
      checkpoint: false,
      status: "OK",
      accountId,
      remoteAccountId: remoteId,
    });
  } catch (error: unknown) {
    console.error("[pages/api/accounts/auth-native] Error en autenticación con LinkedIn:", error);

    const errStatus = (error as { status?: number })?.status;
    const errBody = (error as { body?: string })?.body || "";
    const isInvalidCreds =
      errStatus === 401 ||
      errBody.toLowerCase().includes("invalid_credentials") ||
      errBody.toLowerCase().includes("credentials");

    if (isInvalidCreds) {
      return res.status(400).json({
        error: "Credenciales de LinkedIn incorrectas. Por favor verifica tu correo y contraseña.",
      });
    }

    return res.status(400).json({
      error: "No se pudo conectar con LinkedIn. Por favor revisa tus datos o inténtalo más tarde.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
