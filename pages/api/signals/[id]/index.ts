import type { NextApiRequest, NextApiResponse } from "next";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { signalRadarService } from "@/lib/signals/service";
import { SignalMonitorPatchSchema, validationMessage } from "@/lib/signals/validation";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const id = typeof req.query.id === "string" ? req.query.id : "";
  if (!id) return res.status(400).json({ error: "ID de monitor inválido" });

  try {
    if (req.method === "GET") {
      const monitor = signalRadarService.getMonitor(id, actor);
      return monitor ? res.status(200).json(monitor) : res.status(404).json({ error: "Monitor no encontrado" });
    }
    if (req.method === "PATCH") {
      const parsed = SignalMonitorPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: validationMessage(parsed.error) });
      const patchData: Record<string, unknown> = { ...parsed.data };
      if (patchData.keywords !== undefined) {
        patchData.keywords_json = JSON.stringify(patchData.keywords);
        delete patchData.keywords;
      }
      if (patchData.icp_filters !== undefined) {
        patchData.icp_filters_json = JSON.stringify(patchData.icp_filters);
        delete patchData.icp_filters;
      }
      if (patchData.message_config !== undefined) {
        patchData.message_config_json = JSON.stringify(patchData.message_config);
        delete patchData.message_config;
      }
      const db = getDb();
      if (patchData.account_id && !canAccessLinkedInAccount(db, actor, patchData.account_id as string)) {
        return res.status(404).json({ error: "Cuenta de LinkedIn no encontrada o no autorizada" });
      }
      if (patchData.target_list_id && !db.prepare("SELECT 1 FROM lists WHERE id = ?").get(patchData.target_list_id)) {
        return res.status(404).json({ error: "Lista de destino no encontrada" });
      }
      if (patchData.target_workflow_id && !db.prepare("SELECT 1 FROM workflows WHERE id = ? AND COALESCE(is_archived, 0) = 0").get(patchData.target_workflow_id)) {
        return res.status(404).json({ error: "Workflow no encontrado" });
      }
      const updated = signalRadarService.updateMonitor(id, patchData, actor);
      return updated ? res.status(200).json(updated) : res.status(404).json({ error: "Monitor no encontrado" });
    }
    if (req.method === "DELETE") {
      try {
        const deleted = signalRadarService.deleteMonitor(id, actor);
        return deleted ? res.status(200).json({ success: true }) : res.status(404).json({ error: "Monitor no encontrado" });
      } catch (error) {
        return res.status(409).json({ error: error instanceof Error ? error.message : "No se pudo eliminar el monitor" });
      }
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Error procesando monitor" });
  }
}
