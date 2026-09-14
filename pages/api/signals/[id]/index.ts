import type { NextApiRequest, NextApiResponse } from "next";
import { requireApiActor } from "@/lib/authz";
import { signalRadarService } from "@/lib/signals/service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const { id } = req.query;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "ID de monitor inválido" });
  }

  if (req.method === "GET") {
    try {
      const monitor = signalRadarService.getMonitor(id);
      if (!monitor) {
        return res.status(404).json({ error: "Monitor no encontrado" });
      }
      return res.status(200).json(monitor);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Error al obtener monitor" });
    }
  }

  if (req.method === "PATCH") {
    try {
      const updated = signalRadarService.updateMonitor(id, req.body);
      if (!updated) {
        return res.status(404).json({ error: "Monitor no encontrado" });
      }
      return res.status(200).json(updated);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Error al actualizar monitor" });
    }
  }

  if (req.method === "DELETE") {
    try {
      const deleted = signalRadarService.deleteMonitor(id);
      if (!deleted) {
        return res.status(404).json({ error: "Monitor no encontrado" });
      }
      return res.status(200).json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Error al eliminar monitor" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
