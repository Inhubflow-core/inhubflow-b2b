import type { NextApiRequest, NextApiResponse } from "next";
import { requireApiActor } from "@/lib/authz";
import { signalRadarService } from "@/lib/signals/service";
import { SignalLeadStatusSchema } from "@/lib/signals/validation";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed. Use GET." });
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  try {
    const rawStatus = typeof req.query.status === "string" ? req.query.status : undefined;
    const status = rawStatus ? SignalLeadStatusSchema.safeParse(rawStatus) : null;
    if (status && !status.success) return res.status(400).json({ error: "Estado de lead inválido" });
    const data = signalRadarService.listLeads({
      monitor_id: typeof req.query.monitor_id === "string" ? req.query.monitor_id : undefined,
      status: status?.success ? status.data : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : 50,
      offset: typeof req.query.offset === "string" ? Number(req.query.offset) : 0,
    }, actor);
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Error al listar prospectos" });
  }
}
