import type Database from "better-sqlite3";

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  start_time: string; // ISO8601 UTC
  end_time: string;   // ISO8601 UTC
  target_id: string | null;
  meeting_link: string | null;
  location: string | null;
  status: "confirmed" | "completed" | "cancelled" | "no_show";
  channel: "linkedin" | "email" | "manual" | "sdr_ai";
  created_by: string | null;
  workspace_owner_id: string | null;
  // Ecosystem linkage: where this meeting came from.
  run_id: string | null;
  list_id: string | null;
  thread_id: string | null;
  decision_id: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarSettings {
  id: string;
  workspace_owner_id: string | null;
  slot_duration_minutes: number;
  buffer_time_minutes: number;
  working_hours_json: string;
  timezone: string;
  min_notice_hours: number;
  default_meeting_link: string | null;
  feed_token: string | null;
  updated_at: string;
}

export type MeetingRequestStatus = "pending" | "scheduled" | "declined" | "expired";

export interface CalendarMeetingRequest {
  id: string;
  workspace_owner_id: string | null;
  thread_id: string | null;
  decision_id: string | null;
  target_id: string | null;
  duration_minutes: number;
  proposed_slots_json: string;
  status: MeetingRequestStatus;
  created_event_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_WORKING_HOURS = JSON.stringify({
  mon: [{ start: "09:00", end: "18:00" }],
  tue: [{ start: "09:00", end: "18:00" }],
  wed: [{ start: "09:00", end: "18:00" }],
  thu: [{ start: "09:00", end: "18:00" }],
  fri: [{ start: "09:00", end: "18:00" }],
  sat: [],
  sun: [],
});

export const CALENDAR_STATUSES = ["confirmed", "completed", "cancelled", "no_show"] as const;
export const CALENDAR_CHANNELS = ["linkedin", "email", "manual", "sdr_ai"] as const;
export const CALENDAR_SOURCES = ["manual", "public_booking", "sdr_ai", "campaign"] as const;

function tableColumns(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((col) => col.name)
  );
}

function hasTable(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  );
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  if (!hasTable(db, table) || tableColumns(db, table).has(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function applyCalendarSchema(db: Database.Database): void {
  db.transaction(() => {
    // 1. Create calendar_events table
    db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
        meeting_link TEXT,
        location TEXT,
        status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'completed', 'cancelled', 'no_show')),
        channel TEXT NOT NULL DEFAULT 'manual' CHECK(channel IN ('linkedin', 'email', 'manual', 'sdr_ai')),
        created_by TEXT,
        workspace_owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_time ASC);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_target ON calendar_events(target_id);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_status ON calendar_events(status);
    `);

    // 1b. Ecosystem linkage + workspace scoping indexes (additive).
    ensureColumn(db, "calendar_events", "run_id", "TEXT");
    ensureColumn(db, "calendar_events", "list_id", "TEXT");
    ensureColumn(db, "calendar_events", "thread_id", "TEXT");
    ensureColumn(db, "calendar_events", "decision_id", "TEXT");
    ensureColumn(db, "calendar_events", "source", "TEXT");
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_calendar_events_workspace ON calendar_events(workspace_owner_id, start_time ASC);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_run ON calendar_events(run_id);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_list ON calendar_events(list_id);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_thread ON calendar_events(thread_id);
    `);

    // 2. Create calendar_settings table (per-workspace; 'default' row is the global fallback)
    db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_settings (
        id TEXT PRIMARY KEY DEFAULT 'default',
        slot_duration_minutes INTEGER NOT NULL DEFAULT 30,
        buffer_time_minutes INTEGER NOT NULL DEFAULT 15,
        working_hours_json TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'America/Santiago',
        min_notice_hours INTEGER NOT NULL DEFAULT 4,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    ensureColumn(db, "calendar_settings", "workspace_owner_id", "TEXT REFERENCES users(id) ON DELETE CASCADE");
    ensureColumn(db, "calendar_settings", "default_meeting_link", "TEXT");
    ensureColumn(db, "calendar_settings", "feed_token", "TEXT");
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_settings_workspace
        ON calendar_settings(workspace_owner_id) WHERE workspace_owner_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_calendar_settings_feed_token
        ON calendar_settings(feed_token) WHERE feed_token IS NOT NULL;
    `);

    // 3. Seed default settings idempotently
    const insertSettings = db.prepare(`
      INSERT OR IGNORE INTO calendar_settings (id, slot_duration_minutes, buffer_time_minutes, working_hours_json, timezone, min_notice_hours)
      VALUES ('default', 30, 15, ?, 'America/Santiago', 4)
    `);
    insertSettings.run(DEFAULT_WORKING_HOURS);

    // 4. SDR IA → calendar: the agent proposes, a human approves (mode is 'approval').
    db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_meeting_requests (
        id TEXT PRIMARY KEY,
        workspace_owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        thread_id TEXT,
        decision_id TEXT,
        target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 30,
        proposed_slots_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'scheduled', 'declined', 'expired')),
        created_event_id TEXT,
        decided_by TEXT,
        decided_at TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_calendar_requests_workspace
        ON calendar_meeting_requests(workspace_owner_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_calendar_requests_target ON calendar_meeting_requests(target_id);
    `);

    // 5. Audit trail for calendar mutations (who moved/cancelled a meeting and why).
    db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_audit (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        workspace_owner_id TEXT,
        action TEXT NOT NULL,
        actor_user_id TEXT,
        detail_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_calendar_audit_event ON calendar_audit(event_id, created_at DESC);
    `);
  })();
}
