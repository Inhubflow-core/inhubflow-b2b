/**
 * IANA timezone helpers for the calendar module.
 *
 * All timestamps are persisted as UTC ISO strings. Slots, working hours and the
 * availability grid, however, are expressed in the workspace's IANA timezone
 * (America/Santiago by default), so every wall-clock conversion has to go through
 * Intl instead of the server's local offset. That also keeps DST transitions
 * correct: Chile moves between -04 and -03, which shifts every slot by an hour.
 *
 * No external dependency is used — Node ships the full IANA database.
 */

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DEFAULT_TIMEZONE = "America/Santiago";

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
  hour: number;  // 0-23
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIMEZONE;
  try {
    // Throws RangeError on unknown zones.
    partsFormatter(timeZone);
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function normalizeTimeZone(timeZone: string | null | undefined): string {
  return safeTimeZone(timeZone);
}

/** Wall-clock parts of a UTC instant in the given IANA zone. */
export function zonedParts(instant: Date | string | number, timeZone?: string | null): ZonedParts {
  const date = instant instanceof Date ? instant : new Date(instant);
  const zone = safeTimeZone(timeZone);
  const parts = partsFormatter(zone).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const hour = get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Intl emits "24" for midnight with hour12:false on some ICU versions.
    hour: hour === 24 ? 0 : hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset in minutes between UTC and the zone at that instant (positive east of UTC). */
export function zoneOffsetMinutes(instant: Date | string | number, timeZone?: string | null): number {
  const date = instant instanceof Date ? instant : new Date(instant);
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - (date.getTime() - date.getMilliseconds())) / 60000);
}

/**
 * Converts a wall-clock date/time in the zone into a UTC Date.
 * Resolves twice so DST transitions land on the correct side.
 */
export function utcFromZoned(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone?: string | null,
): Date {
  const zone = safeTimeZone(timeZone);
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstGuess = new Date(naive - zoneOffsetMinutes(new Date(naive), zone) * 60000);
  const secondOffset = zoneOffsetMinutes(firstGuess, zone);
  return new Date(naive - secondOffset * 60000);
}

/** "YYYY-MM-DD" of a UTC instant as seen in the zone. */
export function dayKeyInZone(instant: Date | string | number, timeZone?: string | null): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "HH:mm" of a UTC instant in the zone. */
export function timeLabelInZone(instant: Date | string | number, timeZone?: string | null): string {
  const p = zonedParts(instant, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Weekday key ("mon"…"sun") of a wall-clock date. Timezone independent. */
export function dayKeyOfWallDate(year: number, month: number, day: number): DayKey {
  return DAY_KEYS[new Date(year, month - 1, day).getDay()];
}

/** Inclusive UTC bounds of a wall-clock day in the zone: [start, end). */
export function dayBoundsInZone(dateStr: string, timeZone?: string | null): { start: Date; end: Date } {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${dateStr}`);
  const start = utcFromZoned(y, m, d, 0, 0, timeZone);
  const end = utcFromZoned(y, m, d + 1, 0, 0, timeZone);
  return { start, end };
}

/** Parses "HH:mm" into minutes since midnight; returns null when malformed. */
export function parseClock(value: unknown): { hour: number; minute: number } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Formats a UTC instant for humans, in the zone, with an explicit locale. */
export function formatInZone(
  instant: Date | string | number,
  timeZone: string | null | undefined,
  locale = "es-CL",
  options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  },
): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: safeTimeZone(timeZone) }).format(date);
  } catch {
    return date.toISOString();
  }
}
