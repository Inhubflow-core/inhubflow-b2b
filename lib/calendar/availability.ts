import type Database from "better-sqlite3";
import { getCalendarSettings } from "./settings";
import {
  dayBoundsInZone,
  dayKeyInZone,
  dayKeyOfWallDate,
  parseClock,
  timeLabelInZone,
  utcFromZoned,
} from "./time";

export interface AvailabilitySlot {
  time: string;
  start_time: string;
  end_time: string;
  available: boolean;
}

export interface AvailabilityResult {
  date: string;
  dayOfWeek: string;
  slots: AvailabilitySlot[];
  slot_duration_minutes: number;
  timezone: string;
}

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
          return { start: `${String(start.hour).padStart(2, "0")}:${String(start.minute).padStart(2, "0")}`, end: `${String(end.hour).padStart(2, "0")}:${String(end.minute).padStart(2, "0")}` };
        })
        .filter((x): x is WorkingInterval => x !== null);
    }
    return map;
  } catch {
    return FALLBACK_WORKING_HOURS;
  }
}

/**
 * Returns any confirmed/completed meeting overlapping [start, end).
 * The previous substring filter (`start_time LIKE 'YYYY-MM-DD%'`) matched a UTC
 * prefix against a local date, so slots near midnight were missed and double
 * bookings slipped through. Range comparison is both correct and indexed.
 */
export function findSlotCollision(
  db: Database.Database,
  startMs: number,
  endMs: number,
  options: { excludeEventId?: string; workspaceOwnerId?: string | null } = {},
): { id: string } | undefined {
  const clauses = [
    "status IN ('confirmed', 'completed')",
    "start_time < ?",
    "end_time > ?",
  ];
  const params: unknown[] = [new Date(endMs).toISOString(), new Date(startMs).toISOString()];

  if (options.excludeEventId) {
    clauses.push("id != ?");
    params.push(options.excludeEventId);
  }
  if (options.workspaceOwnerId) {
    clauses.push("(workspace_owner_id = ? OR workspace_owner_id IS NULL)");
    params.push(options.workspaceOwnerId);
  }

  return db
    .prepare(`SELECT id FROM calendar_events WHERE ${clauses.join(" AND ")} LIMIT 1`)
    .get(...params) as { id: string } | undefined;
}

/**
 * Computes bookable slots for a wall-clock date in the workspace timezone.
 *
 * Overlap is checked against every meeting that touches the day (UTC range of
 * the whole local day), and buffers are enforced on both sides so back-to-back
 * meetings never collide.
 */
export function computeAvailability(
  db: Database.Database,
  date: string,
  options: {
    now?: Date;
    excludeEventId?: string;
    /** Scope settings and busy events to one workspace. Omit for the public booking page. */
    workspaceOwnerId?: string | null;
  } = {},
): AvailabilityResult {
  const settings = getCalendarSettings(db, options.workspaceOwnerId ?? null);
  const timeZone = settings.timezone;

  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${date}`);
  const dayOfWeek = dayKeyOfWallDate(y, m, d);
  const intervals = parseWorkingHours(settings.working_hours_json)[dayOfWeek] ?? [];

  if (intervals.length === 0) {
    return {
      date,
      dayOfWeek,
      slots: [],
      slot_duration_minutes: settings.slot_duration_minutes,
      timezone: timeZone,
    };
  }

  const { start: dayStart, end: dayEnd } = dayBoundsInZone(date, timeZone);
  const busyClauses = ["status IN ('confirmed', 'completed')", "start_time < ?", "end_time > ?"];
  const busyParams: unknown[] = [dayEnd.toISOString(), dayStart.toISOString()];
  if (options.workspaceOwnerId) {
    busyClauses.push("(workspace_owner_id = ? OR workspace_owner_id IS NULL)");
    busyParams.push(options.workspaceOwnerId);
  }
  const booked = db
    .prepare(`
      SELECT start_time, end_time FROM calendar_events
      WHERE ${busyClauses.join(" AND ")}
    `)
    .all(...busyParams) as Array<{ start_time: string; end_time: string }>;

  const slotMinutes = Math.max(5, settings.slot_duration_minutes || 30);
  const slotMs = slotMinutes * 60_000;
  const bufferMs = Math.max(0, settings.buffer_time_minutes || 0) * 60_000;
  const minNoticeMs = Math.max(0, settings.min_notice_hours || 0) * 3_600_000;
  const nowMs = (options.now ?? new Date()).getTime();

  const slots: AvailabilitySlot[] = [];

  for (const interval of intervals) {
    const startClock = parseClock(interval.start);
    const endClock = parseClock(interval.end);
    if (!startClock || !endClock) continue;

    const intervalStart = utcFromZoned(y, m, d, startClock.hour, startClock.minute, timeZone).getTime();
    const intervalEnd = utcFromZoned(y, m, d, endClock.hour, endClock.minute, timeZone).getTime();

    for (let slotStartMs = intervalStart; slotStartMs + slotMs <= intervalEnd; slotStartMs += slotMs) {
      const slotEndMs = slotStartMs + slotMs;
      // Buffer is respected on both sides so consecutive meetings never collide.
      const blockedFrom = slotStartMs - bufferMs;
      const blockedTo = slotEndMs + bufferMs;

      let available = slotStartMs >= nowMs + minNoticeMs;

      if (available) {
        for (const evt of booked) {
          if (options.excludeEventId) continue;
          const evtStartMs = new Date(evt.start_time).getTime();
          const evtEndMs = new Date(evt.end_time).getTime();
          if (blockedFrom < evtEndMs && blockedTo > evtStartMs) {
            available = false;
            break;
          }
        }
      }

      slots.push({
        time: timeLabelInZone(slotStartMs, timeZone),
        start_time: new Date(slotStartMs).toISOString(),
        end_time: new Date(slotEndMs).toISOString(),
        available,
      });
    }
  }

  return {
    date,
    dayOfWeek,
    slots,
    slot_duration_minutes: settings.slot_duration_minutes,
    timezone: timeZone,
  };
}

/** The next N available slots across the upcoming days (used by the SDR for offers). */
export function suggestSlots(
  db: Database.Database,
  options: {
    days?: number;
    count?: number;
    durationMinutes?: number;
    from?: Date;
    workspaceOwnerId?: string | null;
  } = {},
): Array<{ start_time: string; end_time: string; label: string }> {
  const settings = getCalendarSettings(db, options.workspaceOwnerId ?? null);
  const timeZone = settings.timezone;
  const days = Math.max(1, Math.min(options.days ?? 7, 30));
  const wanted = Math.max(1, Math.min(options.count ?? 3, 10));
  const from = options.from ?? new Date();

  const out: Array<{ start_time: string; end_time: string; label: string }> = [];
  for (let i = 0; i < days && out.length < wanted; i++) {
    const dayKey = dayKeyInZone(new Date(from.getTime() + i * 86_400_000), timeZone);
    let slots: AvailabilitySlot[];
    try {
      slots = computeAvailability(db, dayKey, {
        now: from,
        workspaceOwnerId: options.workspaceOwnerId ?? null,
      }).slots;
    } catch {
      continue;
    }
    for (const slot of slots) {
      if (!slot.available) continue;
      out.push({
        start_time: slot.start_time,
        end_time: slot.end_time,
        label: `${dayKey} ${slot.time} (${timeZone})`,
      });
      if (out.length >= wanted) break;
    }
  }
  return out;
}
