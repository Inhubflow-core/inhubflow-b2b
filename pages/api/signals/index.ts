import type { NextApiRequest, NextApiResponse } from "next";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { signalRadarService } from "@/lib/signals/service";
import { SignalMonitorCreateSchema, validationMessage } from "@/lib/signals/validation";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;

  try {
    if (req.method === "GET") {
      return res.status(200).json({ items: signalRadarService.listMonitors(actor) });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const parsed = SignalMonitorCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: validationMessage(parsed.error) });
    const input = parsed.data;
    const db = getDb();
    if (!canAccessLinkedInAccount(db, actor, input.account_id)) {
      return res.status(404).json({ error: "Cuenta de LinkedIn no encontrada" });
    }
    if (!db.prepare("SELECT 1 FROM lists WHERE id = ?").get(input.target_list_id)) {
      return res.status(404).json({ error: "Lista de destino no encontrada" });
    }
    if (input.target_workflow_id && !db.prepare("SELECT 1 FROM workflows WHERE id = ? AND COALESCE(is_archived, 0) = 0").get(input.target_workflow_id)) {
      return res.status(404).json({ error: "Workflow no encontrado" });
    }
    const monitor = signalRadarService.createMonitor({
      ...input,
      target_url: input.target_url || undefined,
      target_workflow_id: input.target_workflow_id || undefined,
      created_by: actor.id,
      workspace_owner_id: actor.workspaceOwnerId,
    });
    return res.status(201).json(monitor);
  } catch (error) {
    console.error("[signals/index] Error:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Error procesando monitor" });
  }
}
