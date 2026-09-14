import type { NextApiRequest, NextApiResponse } from "next";
import { requireApiActor } from "@/lib/authz";
import { signalRadarService } from "@/lib/signals/service";
import { SignalLeadStatus } from "@/lib/signals/schema";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  try {
    const { action, lead_id, lead_ids, status, icebreaker_preview, target } = req.body as {
      action: "update_status" | "update_message" | "import";
      lead_id?: string;
      lead_ids?: string[];
      status?: SignalLeadStatus;
      icebreaker_preview?: string;
      target?: { list_id?: string; workflow_id?: string };
    };

    if (action === "update_status") {
      if (!lead_id || !status) {
        return res.status(400).json({ error: "lead_id y status son requeridos" });
      }
      const success = signalRadarService.updateLeadStatus(lead_id, status, icebreaker_preview);
      return res.status(200).json({ success });
    }

    if (action === "update_message") {
      if (!lead_id || icebreaker_preview === undefined) {
        return res.status(400).json({ error: "lead_id e icebreaker_preview son requeridos" });
      }
      const lead = signalRadarService.listLeads({ limit: 1 }).items.find((l) => l.id === lead_id);
      const currentStatus = lead ? lead.status : "pending";
      const success = signalRadarService.updateLeadStatus(lead_id, currentStatus, icebreaker_preview);
      return res.status(200).json({ success });
    }

    if (action === "import") {
      const ids = lead_ids || (lead_id ? [lead_id] : []);
      if (!ids.length) {
        return res.status(400).json({ error: "Se requiere al menos un lead_id para importar" });
      }
      if (!target?.list_id && !target?.workflow_id) {
        return res.status(400).json({ error: "Debe especificarse list_id o workflow_id destino" });
      }

      const result = await signalRadarService.importLeads(ids, target);
      return res.status(200).json({
        success: true,
        imported: result.imported,
        targetIds: result.targetIds,
      });
    }

    return res.status(400).json({ error: "Acción no reconocida" });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error al procesar acción sobre leads" });
  }
}
