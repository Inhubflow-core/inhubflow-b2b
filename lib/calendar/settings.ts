import type Database from "better-sqlite3";
import { randomBytes } from "crypto";
import {
  DEFAULT_WORKING_HOURS,
  type CalendarSettings,
} from "./schema";
import { DEFAULT_TIMEZONE, parseClock } from "./time";

export interface WorkingInterval {
  start: string;
  end: string;
}

export type WorkingHoursMap = Record<string, WorkingInterval[]>;

const FALLBACK_WORKING_HOURS: WorkingHoursMap = {
  mon: [{ start: "09:00", end: "18:00" }],
  tue: [{ start: "09:00", end: "18:00" }],
  wed: [{ start: "09:00", end: "18:00" }],
  thu: [{ start: "09:00", end: "18:00" }],
  fri: [{ start: "09:00", end: "18:00" }],
  sat: [],
  sun: [],
};

/** Falls back to the single global row ('default') when a workspace has none. */
export function getCalendarSettings(
  db: Database.Database,
  workspaceOwnerId?: string | null,
): CalendarSettings {
  if (workspaceOwnerId) {
    const scoped = db
      .prepare("SELECT * FROM calendar_settings WHERE workspace_owner_id = ?")
      .get(workspaceOwnerId) as CalendarSettings | undefined;
    if (scoped) return scoped;
  }

  const row = db.prepare("SELECT * FROM calendar_settings WHERE id = 'default'").get() as
    | CalendarSettings
    | undefined;
  if (row) return row;

  return {
    id: "default",
    workspace_owner_id: null,
    slot_duration_minutes: 30,
    buffer_time_minutes: 15,
    working_hours_json: DEFAULT_WORKING_HOURS,
    timezone: DEFAULT_TIMEZONE,
    min_notice_hours: 4,
    default_meeting_link: null,
    feed_token: null,
    updated_at: new Date().toISOString(),
  };
}

export function saveCalendarSettings(
  db: Database.Database,
  settings: Partial<CalendarSettings>,
  workspaceOwnerId?: string | null,
): CalendarSettings {
  const now = new Date().toISOString();
  const current = getCalendarSettings(db, workspaceOwnerId ?? null);
  // A scoped row exists only if what we read back belongs to this workspace;
  // otherwise we are still looking at the shared 'default' fallback.
  const scoped = Boolean(workspaceOwnerId)
    ? current.workspace_owner_id === workspaceOwnerId
    : db.prepare("SELECT id FROM calendar_settings WHERE id = 'default'").get() !== undefined;

  // Rotation replaces the token; a plain save keeps the existing one.
  const feedToken = settings.feed_token ?? current.feed_token ?? randomBytes(18).toString("base64url");

  const merged = {
    slot_duration_minutes: settings.slot_duration_minutes ?? current.slot_duration_minutes,
    buffer_time_minutes: settings.buffer_time_minutes ?? current.buffer_time_minutes,
    working_hours_json: settings.working_hours_json ?? current.working_hours_json,
    timezone: settings.timezone ?? current.timezone,
    min_notice_hours: settings.min_notice_hours ?? current.min_notice_hours,
    default_meeting_link: settings.default_meeting_link ?? current.default_meeting_link,
  };

  if (scoped) {
    db.prepare(`
      UPDATE calendar_settings SET
        slot_duration_minutes = ?,
        buffer_time_minutes = ?,
        working_hours_json = ?,
        timezone = ?,
        min_notice_hours = ?,
        default_meeting_link = ?,
        feed_token = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      merged.slot_duration_minutes,
      merged.buffer_time_minutes,
      merged.working_hours_json,
      merged.timezone,
      merged.min_notice_hours,
      merged.default_meeting_link,
      feedToken,
      now,
      current.id,
    );
    return getCalendarSettings(db, workspaceOwnerId ?? null);
  }

  db.prepare(`
    INSERT INTO calendar_settings (
      id, workspace_owner_id, slot_duration_minutes, buffer_time_minutes,
      working_hours_json, timezone, min_notice_hours, default_meeting_link,
      feed_token, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workspaceOwnerId ? `ws_${workspaceOwnerId}` : "default",
    workspaceOwnerId ?? null,
    merged.slot_duration_minutes,
    merged.buffer_time_minutes,
    merged.working_hours_json,
    merged.timezone,
    merged.min_notice_hours,
    merged.default_meeting_link,
    feedToken,
    now,
  );

  return getCalendarSettings(db, workspaceOwnerId ?? null);
}

/** Mints a new feed token, invalidating the previous subscription URL. */
export function rotateFeedToken(db: Database.Database, workspaceOwnerId?: string | null): string {
  const token = randomBytes(18).toString("base64url");
  saveCalendarSettings(db, { feed_token: token }, workspaceOwnerId ?? null);
  return token;
}

/** Returns the workspace feed token, creating one on first use. */
export function ensureFeedToken(db: Database.Database, workspaceOwnerId?: string | null): string | null {
  const current = getCalendarSettings(db, workspaceOwnerId);
  if (current.feed_token) return current.feed_token;

  const token = randomBytes(18).toString("base64url");
  saveCalendarSettings(db, { feed_token: token }, workspaceOwnerId ?? null);
  return token;
}

export function parseWorkingHours(json: string | null | undefined): WorkingHoursMap {
  if (!json) return FALLBACK_WORKING_HOURS;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return FALLBACK_WORKING_HOURS;
    const map: WorkingHoursMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) {
        map[key] = [];
        continue;
      }
      map[key] = value
        .map((interval) => {
          if (!interval || typeof interval !== "object") return null;
          const start = parseClock((interval as { start?: unknown }).start);
          const end = parseClock((interval as { end?: unknown }).end);
          if (!start || !end) return null;
          return {
            start: `${String(start.hour).padStart(2, "0")}:${String(start.minute).padStart(2, "0")}`,
            end: `${String(end.hour).padStart(2, "0")}:${String(end.minute).padStart(2, "0")}`,
          };
        })
        .filter((x): x is WorkingInterval => x !== null);
    }
    return map;
  } catch {
    return FALLBACK_WORKING_HOURS;
  }
}
