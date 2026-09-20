import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor } from "@/lib/authz";
import {
  getPipelineCardsByStage,
  getPipelineStagesWithCounts,
  type PipelineCard,
  type PipelineFilterOptions,
} from "@/lib/pipeline/pipeline-service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const db = getDb();

  try {
    const asArray = (value: unknown): string[] | undefined => {
      if (typeof value !== "string" || !value.trim()) return undefined;
      const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
      return parts.length > 0 ? parts : undefined;
    };

    const filters: PipelineFilterOptions = {
      listId: typeof req.query.listId === "string" ? req.query.listId : undefined,
      workflowId: typeof req.query.workflowId === "string" ? req.query.workflowId : undefined,
      listIds: asArray(req.query.listIds),
      workflowIds: asArray(req.query.workflowIds),
      tagSlugs: asArray(req.query.tagSlugs),
      workspaceOwnerId: actor.workspaceOwnerId,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      channel: req.query.channel === "linkedin" || req.query.channel === "email" ? req.query.channel : undefined,
      onlyHumanIntervention: req.query.onlyHumanIntervention === "true",
    };

    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const stageId = typeof req.query.stageId === "string" ? req.query.stageId : undefined;

    if (stageId) {
      const cards = getPipelineCardsByStage(db, stageId, filters, limit, offset);
      return res.json({ stageId, cards });
    }

    // Fetch cards for each stage
    const stages = getPipelineStagesWithCounts(db, filters);
    const cardsByStage: Record<string, PipelineCard[]> = {};

    for (const stage of stages) {
      cardsByStage[stage.id] = getPipelineCardsByStage(db, stage.id, filters, limit, 0);
    }

    return res.json({ cardsByStage });
  } catch (err: unknown) {
    console.error("[pipeline/cards] GET error:", err);
    return res.status(500).json({ error: "Failed to fetch pipeline cards" });
  }
}
