import type { NextApiRequest, NextApiResponse } from "next";
import { requireApiActor } from "@/lib/authz";
import { signalRadarService } from "@/lib/signals/service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const { id } = req.query;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "ID de monitor inválido" });
  }

  try {
    const result = await signalRadarService.scanMonitor(id);
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error al escanear señal" });
  }
}
