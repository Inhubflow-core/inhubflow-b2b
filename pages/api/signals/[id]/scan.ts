import type { NextApiRequest, NextApiResponse } from "next";
import { requireApiActor } from "@/lib/authz";
import { signalRadarService } from "@/lib/signals/service";
import { SignalScanError } from "@/lib/signals/scanners/contracts";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const id = typeof req.query.id === "string" ? req.query.id : "";
  if (!id) return res.status(400).json({ error: "ID de monitor inválido" });

  try {
    const result = await signalRadarService.scanMonitor(id, "manual", actor);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof SignalScanError) {
      const status = error.code === "invalid_configuration" ? 400 : error.code === "unsupported_capability" ? 422 : error.message.includes("ya se está") ? 409 : 502;
      return res.status(status).json({ error: error.message, code: error.code, retryable: error.retryable });
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : "Error al escanear señal" });
  }
}
