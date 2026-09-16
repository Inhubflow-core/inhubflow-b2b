import type { NextApiRequest, NextApiResponse } from "next";
import { requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { signalRadarService } from "@/lib/signals/service";
import { SignalLeadStatusSchema } from "@/lib/signals/validation";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });
  const actor = await requireApiActor(req, res);
  if (!actor) return;

  try {
    const { action, lead_id, lead_ids, status: rawStatus, icebreaker_preview, target } = req.body as {
      action?: "update_status" | "update_message" | "import" | "delete";
      lead_id?: string;
      lead_ids?: string[];
      status?: string;
      icebreaker_preview?: string;
      target?: { list_id?: string; workflow_id?: string };
    };
    if (action === "update_status") {
      if (!lead_id || !rawStatus) return res.status(400).json({ error: "lead_id y status son requeridos" });
      const parsed = SignalLeadStatusSchema.safeParse(rawStatus);
      if (!parsed.success || !["approved", "rejected"].includes(parsed.data)) return res.status(400).json({ error: "Estado no permitido" });
      const success = signalRadarService.updateLeadStatus(lead_id, parsed.data, icebreaker_preview, actor);
      if (!success) return res.status(404).json({ error: "Lead no encontrado" });
      if (parsed.data === "approved") {
        const promotion = signalRadarService.promoteLead(lead_id, { trigger: "manual", listId: target?.list_id, workflowId: target?.workflow_id }, actor);
        return res.status(200).json({ success: true, promotion });
      }
      return res.status(200).json({ success: true });
    }
    if (action === "update_message") {
      if (!lead_id || typeof icebreaker_preview !== "string") return res.status(400).json({ error: "lead_id e icebreaker_preview son requeridos" });
      if (icebreaker_preview.trim().length < 20 || icebreaker_preview.length > 2_000) return res.status(400).json({ error: "El mensaje debe tener entre 20 y 2000 caracteres" });
      const lead = signalRadarService.getLead(lead_id, actor);
      if (!lead) return res.status(404).json({ error: "Lead no encontrado" });
      const success = signalRadarService.updateLeadStatus(lead_id, lead.status, icebreaker_preview.trim(), actor);
      return res.status(200).json({ success });
    }
    if (action === "delete") {
      const ids = Array.isArray(lead_ids) ? lead_ids : lead_id ? [lead_id] : [];
      if (ids.length === 0) return res.status(400).json({ error: "Selecciona al menos un lead" });
      if (ids.length > 500) return res.status(400).json({ error: "Puedes eliminar hasta 500 leads por operación" });
      const result = signalRadarService.deleteLeads(ids, actor);
      return res.status(200).json({ success: true, ...result });
    }
    if (action === "import") {
      const ids = Array.isArray(lead_ids) ? lead_ids : lead_id ? [lead_id] : [];
      if (ids.length === 0) return res.status(400).json({ error: "Selecciona al menos un lead" });
      if (!target?.list_id) return res.status(400).json({ error: "Selecciona una lista de destino" });
      const db = getDb();
      if (!db.prepare("SELECT 1 FROM lists WHERE id = ?").get(target.list_id)) return res.status(404).json({ error: "Lista no encontrada" });
      if (target.workflow_id && !db.prepare("SELECT 1 FROM workflows WHERE id = ?").get(target.workflow_id)) return res.status(404).json({ error: "Workflow no encontrado" });
      const result = await signalRadarService.importLeads(ids, target, actor);
      return res.status(200).json({ success: true, ...result });
    }
    return res.status(400).json({ error: "Acción no reconocida" });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Error al procesar acción" });
  }
}
