import type Database from "better-sqlite3";

/**
 * Pure data access for the tag module. Kept free of any pipeline dependency so
 * that pipeline-service can read tags without creating an import cycle
 * (tags-service → pipeline-service → tags-repository).
 */

export interface Tag {
  id: string;
  workspace_owner_id: string | null;
  name: string;
  slug: string;
  color: string;
  kind: "system" | "custom";
  stage_id: string | null;
  is_active: number;
  created_at: string;
}

export function resolveTagBySlug(
  db: Database.Database,
  slug: string,
  workspaceOwnerId?: string | null
): Tag | undefined {
  return db
    .prepare(
      `SELECT * FROM tags
       WHERE slug = ? AND is_active = 1
         AND (workspace_owner_id IS NULL ${workspaceOwnerId ? "OR workspace_owner_id = ?" : ""})
       ORDER BY (workspace_owner_id IS NULL) ASC
       LIMIT 1`
    )
    .get(...(workspaceOwnerId ? [slug, workspaceOwnerId] : [slug])) as Tag | undefined;
}

export function resolveTagById(db: Database.Database, id: string): Tag | undefined {
  return db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as Tag | undefined;
}

export function listTags(db: Database.Database, workspaceOwnerId?: string | null): Tag[] {
  return db
    .prepare(
      `SELECT * FROM tags
       WHERE is_active = 1
         AND (workspace_owner_id IS NULL ${workspaceOwnerId ? "OR workspace_owner_id = ?" : ""})
       ORDER BY kind DESC, name ASC`
    )
    .all(...(workspaceOwnerId ? [workspaceOwnerId] : [])) as Tag[];
}

export function getTargetTags(db: Database.Database, targetId: string): Tag[] {
  return db
    .prepare(
      `SELECT tg.* FROM target_tags tt
       JOIN tags tg ON tg.id = tt.tag_id
       WHERE tt.target_id = ?
       ORDER BY tg.name ASC`
    )
    .all(targetId) as Tag[];
}

export interface CardTag {
  slug: string;
  name: string;
  color: string;
  source: string;
}

/** Tags for many targets at once, so the kanban needs a single query per stage. */
export function getTagsForTargets(
  db: Database.Database,
  targetIds: string[]
): Record<string, CardTag[]> {
  const out: Record<string, CardTag[]> = {};
  if (targetIds.length === 0) return out;

  const placeholders = targetIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT tt.target_id, tg.slug, tg.name, tg.color, tt.source
       FROM target_tags tt
       JOIN tags tg ON tg.id = tt.tag_id
       WHERE tt.target_id IN (${placeholders})
       ORDER BY tg.name ASC`
    )
    .all(...targetIds) as Array<{
    target_id: string;
    slug: string;
    name: string;
    color: string;
    source: string;
  }>;

  for (const row of rows) {
    (out[row.target_id] ??= []).push({
      slug: row.slug,
      name: row.name,
      color: row.color,
      source: row.source,
    });
  }
  return out;
}
