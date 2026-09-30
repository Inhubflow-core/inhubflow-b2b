import type { NextApiRequest, NextApiResponse } from "next";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { signalRadarService } from "@/lib/signals/service";

function ownsList(db: ReturnType<typeof getDb>, listId: string, workspaceOwnerId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM lists WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)").get(listId, workspaceOwnerId));
}

function ownsWorkflow(db: ReturnType<typeof getDb>, workflowId: string, workspaceOwnerId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM workflows WHERE id = ? AND (owner_id = ? OR owner_id IS NULL) AND COALESCE(is_archived, 0) = 0").get(workflowId, workspaceOwnerId));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const abortController = new AbortController();
  req.on("aborted", () => abortController.abort());
  res.on("close", () => { if (!res.writableEnded) abortController.abort(); });
  try {
    const { query, account_id, list_id, workflow_id } = req.body as {
      query?: string; account_id?: string; list_id?: string; workflow_id?: string;
    };
    if (!query?.trim() || query.trim().length > 1000) return res.status(400).json({ error: "Ingresa una consulta de investigación de hasta 1000 caracteres" });
    if (!account_id) return res.status(400).json({ error: "Selecciona una cuenta de LinkedIn" });
    const db = getDb();
    if (!canAccessLinkedInAccount(db, actor, account_id)) return res.status(404).json({ error: "Cuenta de LinkedIn no encontrada" });
    if (list_id && !ownsList(db, list_id, actor.workspaceOwnerId)) return res.status(404).json({ error: "Lista no encontrada o no pertenece a tu workspace" });
    if (workflow_id && !ownsWorkflow(db, workflow_id, actor.workspaceOwnerId)) return res.status(404).json({ error: "Workflow no encontrado o no pertenece a tu workspace" });
    const result = await signalRadarService.executeAskResearch(query.trim(), {
      accountId: account_id, workspaceOwnerId: actor.workspaceOwnerId, actorId: actor.id,
      listId: list_id, workflowId: workflow_id, isSuperAdmin: actor.isSuperAdmin,
      shouldAbort: () => abortController.signal.aborted,
    });
    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (abortController.signal.aborted || message === "Investigación cancelada") return res.status(499).json({ error: "Investigación cancelada", code: "ask_cancelled" });
    const transient = /\b(429|503)\b|unavailable|high demand|resource_exhausted|rate limit/i.test(message);
    if (transient) return res.status(503).json({ error: "El planificador IA está temporalmente ocupado. Prueba nuevamente en unos instantes.", code: "ai_temporarily_unavailable", retryable: true });
    return res.status(500).json({ error: message || "Error procesando Ask AI" });
  }
}
