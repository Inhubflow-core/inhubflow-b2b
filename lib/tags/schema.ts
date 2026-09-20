import type Database from "better-sqlite3";

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

/**
 * System tag taxonomy. `stage_id` is what makes the requirement work: applying a
 * tag pushes the lead to that funnel stage (respecting no-regression rules).
 * Slugs mirror the SDR intents so the AI can emit them directly.
 */
export const DEFAULT_TAGS = [
  { slug: "contacted", name: "Contactado", color: "#3b82f6", stage_id: "stage_contacted" },
  { slug: "connected", name: "Conexión Aceptada", color: "#06b6d4", stage_id: "stage_connected" },
  { slug: "replied", name: "Respondió", color: "#8b5cf6", stage_id: "stage_replied" },
  { slug: "interested", name: "Interesado", color: "#f59e0b", stage_id: "stage_interested" },
  { slug: "pricing", name: "Pregunta Precio", color: "#eab308", stage_id: null },
  { slug: "meeting", name: "Reunión", color: "#10b981", stage_id: "stage_meeting" },
  { slug: "not_interested", name: "No Interesado", color: "#ef4444", stage_id: "stage_not_interested" },
  { slug: "qualified", name: "Calificado", color: "#14b8a6", stage_id: null },
  { slug: "unqualified", name: "No Calificado", color: "#94a3b8", stage_id: null },
] as const;

export const AI_TAG_SLUGS = [
  "interested",
  "pricing",
  "meeting",
  "not_interested",
  "qualified",
  "unqualified",
] as const;

export function applyTagsSchema(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        workspace_owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#3b82f6',
        kind TEXT NOT NULL DEFAULT 'custom' CHECK(kind IN ('system', 'custom')),
        stage_id TEXT REFERENCES pipeline_stages(id) ON DELETE SET NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_scope_slug
        ON tags(COALESCE(workspace_owner_id, '__global__'), slug);
      CREATE INDEX IF NOT EXISTS idx_tags_stage ON tags(stage_id);

      CREATE TABLE IF NOT EXISTS target_tags (
        target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('ai', 'manual', 'rule')),
        confidence REAL,
        applied_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (target_id, tag_id)
      );
      CREATE INDEX IF NOT EXISTS idx_target_tags_tag ON target_tags(tag_id);

      CREATE TABLE IF NOT EXISTS tag_events (
        id TEXT PRIMARY KEY,
        target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
        action TEXT NOT NULL CHECK(action IN ('added', 'removed')),
        source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('ai', 'manual', 'rule')),
        reason TEXT,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        thread_id TEXT,
        decision_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_tag_events_target ON tag_events(target_id, created_at DESC);
    `);

    // Seed the system taxonomy idempotently. Rows are global (workspace_owner_id NULL)
    // so every workspace can resolve AI slugs; custom tags stay workspace-scoped.
    const insert = db.prepare(`
      INSERT OR IGNORE INTO tags (id, workspace_owner_id, name, slug, color, kind, stage_id)
      VALUES (?, NULL, ?, ?, ?, 'system', ?)
    `);
    for (const tag of DEFAULT_TAGS) {
      insert.run(`tag_sys_${tag.slug}`, tag.name, tag.slug, tag.color, tag.stage_id);
    }
  })();
}
