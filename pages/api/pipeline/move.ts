import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor } from "@/lib/authz";
import { moveTargetToStage } from "@/lib/pipeline/pipeline-service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const db = actor.db;

  try {
    const { targetId, stageId, note } = req.body ?? {};

    if (!targetId || typeof targetId !== "string") {
      return res.status(400).json({ error: "targetId is required" });
    }

    if (!stageId || typeof stageId !== "string") {
      return res.status(400).json({ error: "stageId is required" });
    }

    const success = moveTargetToStage(
      db,
      targetId,
      stageId,
      typeof note === "string" ? note : undefined
    );

    if (!success) {
      return res.status(404).json({ error: "Target or Stage not found" });
    }

    return res.json({ ok: true, targetId, stageId });
  } catch (err: unknown) {
    console.error("[pipeline/move] POST error:", err);
    return res.status(500).json({ error: "Failed to move target in pipeline" });
  }
}
