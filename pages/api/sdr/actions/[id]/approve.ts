import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { canAccessSdrThread, requireApiActor } from "@/lib/authz";
import { dispatchApprovedSdrAction } from "@/lib/sdr-agent/dispatcher";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const actionId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!actionId) return res.status(400).json({ error: "Action id is required" });

  const db = getDb();
  const action = db.prepare(`
    SELECT id, thread_id, workspace_owner_id, state FROM sdr_actions WHERE id = ?
  `).get(actionId) as { id: string; thread_id: string; workspace_owner_id: string | null; state: string } | undefined;

  if (!action) {
    return res.status(404).json({ error: "Acción SDR no encontrada" });
  }

  if (action.state !== "proposed" && action.state !== "waiting_approval") {
    return res.status(409).json({ error: `La acción ya fue procesada o no está disponible para aprobación (estado actual: ${action.state})` });
  }

  if (!canAccessSdrThread(db, actor, action.thread_id)) {
    return res.status(404).json({ error: "Conversación no encontrada o no autorizada" });
  }

  const editedBody = typeof req.body?.editedBody === "string" ? req.body.editedBody : undefined;

  try {
    const result = await dispatchApprovedSdrAction(db, {
      actionId,
      actorUserId: actor.id,
      workspaceOwnerId: actor.workspaceOwnerId,
      editedBody,
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(409).json({
      error: error instanceof Error ? error.message : "Error al despachar la respuesta del SDR",
    });
  }
}
