import type { NextApiRequest, NextApiResponse } from "next";
import { requireApiActor } from "@/lib/authz";
import { signalRadarService } from "@/lib/signals/service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const id = typeof req.query.id === "string" ? req.query.id : "";
  if (!id) return res.status(400).json({ error: "ID de monitor inválido" });
  try {
    return res.status(200).json(signalRadarService.getAutopilotReadiness(id, actor));
  } catch (error) {
    return res.status(404).json({ error: error instanceof Error ? error.message : "Monitor no encontrado" });
  }
}
