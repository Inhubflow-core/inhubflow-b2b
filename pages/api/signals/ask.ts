import type { NextApiRequest, NextApiResponse } from "next";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { signalRadarService } from "@/lib/signals/service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  try {
    const { query, account_id, list_id, workflow_id } = req.body as {
      query?: string;
      account_id?: string;
      list_id?: string;
      workflow_id?: string;
    };
    if (!query?.trim()) return res.status(400).json({ error: "Ingresa una consulta de investigación" });
    if (!account_id) return res.status(400).json({ error: "Selecciona una cuenta de LinkedIn" });
    const db = getDb();
    if (!canAccessLinkedInAccount(db, actor, account_id)) return res.status(404).json({ error: "Cuenta de LinkedIn no encontrada" });
    if (list_id && !db.prepare("SELECT 1 FROM lists WHERE id = ?").get(list_id)) return res.status(404).json({ error: "Lista no encontrada" });
    if (workflow_id && !db.prepare("SELECT 1 FROM workflows WHERE id = ?").get(workflow_id)) return res.status(404).json({ error: "Workflow no encontrado" });
    const result = await signalRadarService.executeAskResearch(query.trim(), {
      accountId: account_id,
      workspaceOwnerId: actor.workspaceOwnerId,
      actorId: actor.id,
      listId: list_id,
      workflowId: workflow_id,
      isSuperAdmin: actor.isSuperAdmin,
    });
    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const transient = /\b(429|503)\b|unavailable|high demand|resource_exhausted|rate limit/i.test(message);
    if (transient) {
      return res.status(503).json({
        error: "El planificador IA está temporalmente ocupado. InHubFlow volverá a intentarlo con un modelo alternativo; prueba nuevamente en unos instantes.",
        code: "ai_temporarily_unavailable",
        retryable: true,
      });
    }
    return res.status(500).json({ error: message || "Error procesando Ask AI" });
  }
}
