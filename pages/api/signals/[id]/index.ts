import type { NextApiRequest, NextApiResponse } from "next";
import { requireApiActor } from "@/lib/authz";
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
      const updated = signalRadarService.updateMonitor(id, parsed.data, actor);
      return updated ? res.status(200).json(updated) : res.status(404).json({ error: "Monitor no encontrado" });
    }
    if (req.method === "DELETE") {
      const deleted = signalRadarService.deleteMonitor(id, actor);
      return deleted ? res.status(200).json({ success: true }) : res.status(404).json({ error: "Monitor no encontrado" });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Error procesando monitor" });
  }
}
