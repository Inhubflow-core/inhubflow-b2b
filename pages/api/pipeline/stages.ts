import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { actorCanAccessWorkspace, requireApiActor, type ApiActor } from "@/lib/authz";
import { getPipelineStagesWithCounts, type PipelineFilterOptions } from "@/lib/pipeline/pipeline-service";
import { randomUUID } from "crypto";

/**
 * Global stages (workspace_owner_id NULL) are shared by every workspace, so only
 * an owner/admin may rename or delete them. Custom stages are workspace-scoped.
 */
function canManageStage(
  actor: ApiActor,
  stage: { workspace_owner_id: string | null }
): boolean {
  if (stage.workspace_owner_id === null) {
    return actor.isWorkspaceAdmin || actor.isSuperAdmin;
  }
  return actorCanAccessWorkspace(actor, stage.workspace_owner_id);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const db = getDb();

  if (req.method === "GET") {
    try {
      const filters: PipelineFilterOptions = {
        listId: typeof req.query.listId === "string" ? req.query.listId : undefined,
        workflowId: typeof req.query.workflowId === "string" ? req.query.workflowId : undefined,
        workspaceOwnerId: actor.workspaceOwnerId,
        search: typeof req.query.search === "string" ? req.query.search : undefined,
        channel: req.query.channel === "linkedin" || req.query.channel === "email" ? req.query.channel : undefined,
        onlyHumanIntervention: req.query.onlyHumanIntervention === "true",
      };

      const stages = getPipelineStagesWithCounts(db, filters);
      return res.json({ stages });
    } catch (err: unknown) {
      console.error("[pipeline/stages] GET error:", err);
      return res.status(500).json({ error: "Failed to fetch pipeline stages" });
    }
  }

  if (req.method === "POST") {
    try {
      const { name, color = "#3b82f6", order_index, trigger_key } = req.body ?? {};
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Stage name is required" });
      }

      // Determine order_index if not provided
      let finalOrder = typeof order_index === "number" ? order_index : null;
      if (finalOrder === null) {
        const maxOrderRow = db.prepare("SELECT MAX(order_index) as m FROM pipeline_stages").get() as { m: number | null };
        finalOrder = (maxOrderRow.m ?? 0) + 1;
      }

      const stageId = `stage_custom_${randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO pipeline_stages (id, name, order_index, color, trigger_key, is_system, workspace_owner_id, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, datetime('now'))
      `).run(
        stageId,
        name.trim(),
        finalOrder,
        color || "#3b82f6",
        trigger_key || null,
        actor.workspaceOwnerId
      );

      const created = db.prepare("SELECT * FROM pipeline_stages WHERE id = ?").get(stageId);
      return res.status(201).json({ stage: created });
    } catch (err: unknown) {
      console.error("[pipeline/stages] POST error:", err);
      return res.status(500).json({ error: "Failed to create pipeline stage" });
    }
  }

  if (req.method === "PATCH") {
    try {
      const { id, name, color, order_index, trigger_key } = req.body ?? {};
      if (!id || typeof id !== "string") {
        return res.status(400).json({ error: "Stage id is required" });
      }

      const existing = db.prepare("SELECT * FROM pipeline_stages WHERE id = ?").get(id) as
        | { id: string; workspace_owner_id: string | null }
        | undefined;
      if (!existing) {
        return res.status(404).json({ error: "Stage not found" });
      }
      if (!canManageStage(actor, existing)) {
        return res.status(404).json({ error: "Stage not found" });
      }

      const updates: string[] = [];
      const params: unknown[] = [];

      if (typeof name === "string" && name.trim()) {
        updates.push("name = ?");
        params.push(name.trim());
      }
      if (typeof color === "string" && color.trim()) {
        updates.push("color = ?");
        params.push(color.trim());
      }
      if (typeof order_index === "number") {
        updates.push("order_index = ?");
        params.push(order_index);
      }
      if (trigger_key !== undefined) {
        updates.push("trigger_key = ?");
        params.push(trigger_key || null);
      }

      if (updates.length > 0) {
        params.push(id);
        db.prepare(`UPDATE pipeline_stages SET ${updates.join(", ")} WHERE id = ?`).run(...params);
      }

      const updated = db.prepare("SELECT * FROM pipeline_stages WHERE id = ?").get(id);
      return res.json({ stage: updated });
    } catch (err: unknown) {
      console.error("[pipeline/stages] PATCH error:", err);
      return res.status(500).json({ error: "Failed to update pipeline stage" });
    }
  }

  if (req.method === "DELETE") {
    try {
      const id = (req.query.id as string) || (req.body?.id as string);
      const reassignStageId = (req.query.reassignStageId as string) || (req.body?.reassignStageId as string) || "stage_contacted";

      if (!id) return res.status(400).json({ error: "Stage id is required" });

      const stage = db.prepare("SELECT * FROM pipeline_stages WHERE id = ?").get(id) as
        | { id: string; is_system: number; workspace_owner_id: string | null }
        | undefined;
      if (!stage) return res.status(404).json({ error: "Stage not found" });

      if (!canManageStage(actor, stage)) {
        return res.status(404).json({ error: "Stage not found" });
      }

      if (stage.is_system === 1) {
        return res.status(403).json({ error: "System stages cannot be deleted" });
      }

      db.transaction(() => {
        // Reassign existing targets to another stage
        db.prepare(`
          UPDATE targets SET stage_id = ?, stage_updated_at = datetime('now')
          WHERE stage_id = ?
        `).run(reassignStageId, id);

        db.prepare("DELETE FROM pipeline_stages WHERE id = ?").run(id);
      })();

      return res.json({ ok: true });
    } catch (err: unknown) {
      console.error("[pipeline/stages] DELETE error:", err);
      return res.status(500).json({ error: "Failed to delete pipeline stage" });
    }
  }

  res.setHeader("Allow", ["GET", "POST", "PATCH", "DELETE"]);
  return res.status(405).end();
}
