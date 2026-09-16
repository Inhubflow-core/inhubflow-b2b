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

  const { accountId, remoteAccountId, code } = req.body as {
    accountId?: string;
    remoteAccountId?: string;
    code?: string;
  };

  if (!accountId || !remoteAccountId || !code?.trim()) {
    return res.status(400).json({
      error: "Por favor ingresa el código de verificación.",
    });
  }

  try {
    const db = getDb();
    const localAccount = db
      .prepare("SELECT id, unipile_account_id FROM accounts WHERE id = ?")
      .get(accountId) as { id: string; unipile_account_id?: string | null } | undefined;

    if (!localAccount || !canAccessLinkedInAccount(db, actor, accountId)) {
      return res.status(404).json({ error: "Cuenta no encontrada o sin permisos de acceso" });
    }

    // Resolver checkpoint en Unipile
    await unipile.solveCheckpoint({
      accountId: remoteAccountId,
      code: code.trim(),
    });

    // Actualizar cuenta como conectada y autenticada
    db.prepare(`
      UPDATE accounts 
      SET unipile_account_id = ?, unipile_status = 'OK', is_authenticated = 1 
      WHERE id = ?
    `).run(remoteAccountId, accountId);

    return res.status(200).json({
      success: true,
      status: "OK",
      accountId,
      remoteAccountId,
    });
  } catch (error: unknown) {
    console.error("[pages/api/accounts/solve-checkpoint] Error al verificar checkpoint:", error);

    const errStatus = (error as { status?: number })?.status;
    const errBody = (error as { body?: string })?.body || "";

    if (
      errStatus === 400 ||
      errStatus === 401 ||
      errBody.toLowerCase().includes("code") ||
      errBody.toLowerCase().includes("checkpoint") ||
      errBody.toLowerCase().includes("invalid")
    ) {
      return res.status(400).json({
        error: "Código de verificación incorrecto o expirado. Por favor inténtalo de nuevo.",
      });
    }

    return res.status(400).json({
      error: "Error al validar el código con LinkedIn.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
