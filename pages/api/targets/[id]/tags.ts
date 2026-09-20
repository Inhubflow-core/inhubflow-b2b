import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor } from "@/lib/authz";
import { applyTagsSchema } from "@/lib/tags/schema";
import { applyTag, getTargetTags, removeTag, resolveTagBySlug } from "@/lib/tags/tags-service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const targetId = req.query.id;
  if (typeof targetId !== "string") return res.status(400).json({ error: "Invalid target id" });

  const db = getDb();
  applyTagsSchema(db);

  const target = db.prepare("SELECT id FROM targets WHERE id = ?").get(targetId) as
    | { id: string }
    | undefined;
  if (!target) return res.status(404).json({ error: "Target not found" });

  if (req.method === "GET") {
    const tags = getTargetTags(db, targetId);
    const events = db
      .prepare(
        `SELECT te.id, te.action, te.source, te.reason, te.created_at, tg.slug, tg.name, tg.color
         FROM tag_events te
         LEFT JOIN tags tg ON tg.id = te.tag_id
         WHERE te.target_id = ?
         ORDER BY te.created_at DESC LIMIT 50`
      )
      .all(targetId);
    return res.json({ tags, events });
  }

  // Manual tagging from the UI. `slug` accepts both an id and a slug.
  if (req.method === "POST") {
    const { slug, tag_id, stage_id } = req.body ?? {};
    const identifier = typeof slug === "string" ? slug : typeof tag_id === "string" ? tag_id : "";
    if (!identifier) return res.status(400).json({ error: "slug or tag_id is required" });

    const tag =
      db.prepare("SELECT * FROM tags WHERE id = ?").get(identifier) as { id: string; slug: string } | undefined ??
      resolveTagBySlug(db, identifier, actor.workspaceOwnerId);
    if (!tag) return res.status(404).json({ error: "Tag not found" });

    const result = applyTag(db, targetId, tag.slug, {
      source: "manual",
      appliedBy: actor.id,
      reason: "Etiquetado manual",
    });

    // Allow overriding the target stage directly when the UI sends one.
    if (stage_id && typeof stage_id === "string") {
      const { moveTargetToStage } = await import("@/lib/pipeline/pipeline-service");
      moveTargetToStage(db, targetId, stage_id, "Etapa actualizada manualmente");
    }

    return res.json({ ok: true, applied: result.applied, advanced: result.advanced });
  }

  if (req.method === "DELETE") {
    const { slug, tag_id } = req.body ?? {};
    const identifier = typeof slug === "string" ? slug : typeof tag_id === "string" ? tag_id : "";
    if (!identifier) return res.status(400).json({ error: "slug or tag_id is required" });

    const tag =
      db.prepare("SELECT * FROM tags WHERE id = ?").get(identifier) as { id: string; slug: string } | undefined ??
      resolveTagBySlug(db, identifier, actor.workspaceOwnerId);
    if (!tag) return res.status(404).json({ error: "Tag not found" });

    const removed = removeTag(db, targetId, tag.slug, {
      source: "manual",
      appliedBy: actor.id,
      reason: "Etiqueta eliminada manualmente",
    });
    return res.json({ ok: true, removed });
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  return res.status(405).end();
}
