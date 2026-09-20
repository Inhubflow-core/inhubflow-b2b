import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor } from "@/lib/authz";
import { randomUUID } from "crypto";
import { applyTagsSchema } from "@/lib/tags/schema";
import { listTags } from "@/lib/tags/tags-service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const db = getDb();
  // Idempotent: keeps working on databases created before this module existed.
  applyTagsSchema(db);

  if (req.method === "GET") {
    const tags = listTags(db, actor.workspaceOwnerId);
    return res.json({ tags });
  }

  if (req.method === "POST") {
    const { name, color = "#3b82f6", stage_id = null } = req.body ?? {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Tag name is required" });
    }

    const slug = name
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!slug) return res.status(400).json({ error: "Tag name is invalid" });

    const existing = db
      .prepare("SELECT id FROM tags WHERE slug = ? AND COALESCE(workspace_owner_id, '__global__') = ?")
      .get(slug, actor.workspaceOwnerId) as { id: string } | undefined;
    if (existing) return res.status(409).json({ error: "Tag already exists" });

    if (stage_id) {
      const stage = db
        .prepare("SELECT id FROM pipeline_stages WHERE id = ? AND (workspace_owner_id IS NULL OR workspace_owner_id = ?)")
        .get(stage_id, actor.workspaceOwnerId) as { id: string } | undefined;
      if (!stage) return res.status(400).json({ error: "Stage not found" });
    }

    const id = `tag_${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO tags (id, workspace_owner_id, name, slug, color, kind, stage_id)
       VALUES (?, ?, ?, ?, ?, 'custom', ?)`
    ).run(id, actor.workspaceOwnerId, name.trim(), slug, color, stage_id ?? null);

    const created = db.prepare("SELECT * FROM tags WHERE id = ?").get(id);
    return res.status(201).json({ tag: created });
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end();
}
