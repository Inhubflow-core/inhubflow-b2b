import type { NextApiRequest, NextApiResponse } from "next";
import { requireApiActor } from "@/lib/authz";
import { signalRadarService } from "@/lib/signals/service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  try {
    const { query, account_id } = req.body as {
      query?: string;
      account_id?: string;
    };

    if (!query || typeof query !== "string" || !query.trim()) {
      return res.status(400).json({ error: "Debes ingresar una consulta de investigación para Ask AI." });
    }

    const result = await signalRadarService.executeAskResearch(query.trim(), account_id);
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error al procesar consulta Ask AI" });
  }
}
