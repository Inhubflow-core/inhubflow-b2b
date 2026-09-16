import type { NextApiRequest, NextApiResponse } from "next";
import { requireApiActor } from "@/lib/authz";
import { signalRadarService } from "@/lib/signals/service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;

  if (req.method === "GET") {
    try {
      const monitors = signalRadarService.listMonitors(actor.id);
      return res.status(200).json({ items: monitors });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Error al obtener monitores" });
    }
  }

  if (req.method === "POST") {
    try {
      const {
        name,
        type,
        target_url,
        competitor_name,
        keywords,
        icp_filters,
        mode,
        account_id,
        target_list_id,
        target_workflow_id,
        message_config,
      } = req.body;

      if (!name || !type) {
        return res.status(400).json({ error: "El nombre y el tipo de señal son obligatorios" });
      }

      const monitor = signalRadarService.createMonitor({
        name,
        type,
        target_url,
        competitor_name,
        keywords,
        icp_filters,
        mode: mode || "review",
        account_id,
        target_list_id,
        target_workflow_id,
        message_config,
        created_by: actor.id,
      });

      return res.status(201).json(monitor);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Error al crear monitor de señal" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
