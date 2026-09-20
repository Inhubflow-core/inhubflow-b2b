import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface CalendarAuditInput {
  eventId: string | null;
  workspaceOwnerId?: string | null;
  action: string;
  actorUserId?: string | null;
  detail?: Record<string, unknown>;
}

function safeJson(value: Record<string, unknown> | undefined): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

/**
 * Writes one row per calendar mutation. The module previously wrote nothing:
 * a cancelled or moved meeting left no trace of who did it or why.
 */
export function recordCalendarAudit(db: Database.Database, input: CalendarAuditInput): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO calendar_audit (id, event_id, workspace_owner_id, action, actor_user_id, detail_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.eventId,
    input.workspaceOwnerId ?? null,
    input.action,
    input.actorUserId ?? null,
    safeJson(input.detail)
  );
  return id;
}

export interface CalendarAuditRow {
  id: string;
  event_id: string | null;
  workspace_owner_id: string | null;
  action: string;
  actor_user_id: string | null;
  actor_email: string | null;
  detail_json: string;
  created_at: string;
}

/** Audit history for one event, or the recent workspace-wide trail. */
export function listCalendarAudit(
  db: Database.Database,
  filter: { eventId?: string; workspaceOwnerId?: string | null; limit?: number } = {}
): CalendarAuditRow[] {
  const clauses: string[] = ["1=1"];
  const params: unknown[] = [];
  if (filter.eventId) {
    clauses.push("a.event_id = ?");
    params.push(filter.eventId);
  }
  if (filter.workspaceOwnerId) {
    clauses.push("(a.workspace_owner_id = ? OR a.workspace_owner_id IS NULL)");
    params.push(filter.workspaceOwnerId);
  }
  params.push(Math.max(1, Math.min(filter.limit ?? 100, 500)));
  return db
    .prepare(`
      SELECT a.*, u.email AS actor_email
      FROM calendar_audit a
      LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY a.created_at DESC, a.rowid DESC
      LIMIT ?
    `)
    .all(...params) as CalendarAuditRow[];
}
