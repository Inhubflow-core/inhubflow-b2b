import type { NextApiRequest, NextApiResponse } from "next";
import { requireApiActor } from "@/lib/authz";
import { signalRadarService } from "@/lib/signals/service";
import { SignalLeadStatus } from "@/lib/signals/schema";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  try {
    const { monitor_id, status, search, limit, offset } = req.query;

    const data = signalRadarService.listLeads({
      monitor_id: typeof monitor_id === "string" ? monitor_id : undefined,
      status: typeof status === "string" ? (status as SignalLeadStatus) : undefined,
      search: typeof search === "string" ? search : undefined,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
    });

    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error al listar prospectos de señales" });
  }
}
