export interface LinkedInSchedule {
  timezone: string;
  workingDays: string;
  activeHoursStart: number;
  activeHoursEnd: number;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function zonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: WEEKDAY_TO_ISO[values.weekday] || 1,
  };
}

function zonedDateTimeToUtc(year: number, month: number, day: number, hour: number, timezone: string): Date {
  const desired = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  let guess = desired;
  for (let pass = 0; pass < 3; pass++) {
    const actual = zonedParts(new Date(guess), timezone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
    guess += desired - actualAsUtc;
  }
  return new Date(guess);
}

function normalizedSchedule(schedule: LinkedInSchedule): LinkedInSchedule & { days: Set<number> } {
  let timezone = schedule.timezone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    timezone = "UTC";
  }
  const days = new Set(
    String(schedule.workingDays || "1,2,3,4,5")
      .split(",")
      .map(Number)
      .filter((day) => day >= 1 && day <= 7),
  );
  if (days.size === 0) [1, 2, 3, 4, 5].forEach((day) => days.add(day));
  const activeHoursStart = Math.min(23, Math.max(0, Number(schedule.activeHoursStart) || 0));
  const rawEnd = Number(schedule.activeHoursEnd);
  const activeHoursEnd = Math.min(24, Math.max(activeHoursStart + 1, Number.isFinite(rawEnd) ? rawEnd : 24));
  return { ...schedule, timezone, activeHoursStart, activeHoursEnd, days };
}

export function linkedInDayBounds(timezone: string, nowMs = Date.now()): { start: string; end: string } {
  let validTimezone = timezone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: validTimezone }).format(new Date());
  } catch {
    validTimezone = "UTC";
  }
  const local = zonedParts(new Date(nowMs), validTimezone);
  const calendar = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const nextCalendar = new Date(calendar.getTime() + 86_400_000);
  return {
    start: zonedDateTimeToUtc(
      calendar.getUTCFullYear(),
      calendar.getUTCMonth() + 1,
      calendar.getUTCDate(),
      0,
      validTimezone,
    ).toISOString(),
    end: zonedDateTimeToUtc(
      nextCalendar.getUTCFullYear(),
      nextCalendar.getUTCMonth() + 1,
      nextCalendar.getUTCDate(),
      0,
      validTimezone,
    ).toISOString(),
  };
}

export function nextAllowedLinkedInTime(
  schedule: LinkedInSchedule,
  nowMs = Date.now(),
): { allowed: boolean; nextAt: string | null } {
  const normalized = normalizedSchedule(schedule);
  const now = new Date(nowMs);
  const local = zonedParts(now, normalized.timezone);
  const minuteOfDay = local.hour * 60 + local.minute;
  const startMinute = normalized.activeHoursStart * 60;
  const endMinute = normalized.activeHoursEnd * 60;
  if (normalized.days.has(local.weekday) && minuteOfDay >= startMinute && minuteOfDay < endMinute) {
    return { allowed: true, nextAt: null };
  }

  const localCalendar = new Date(Date.UTC(local.year, local.month - 1, local.day));
  for (let offset = 0; offset < 15; offset++) {
    const candidateCalendar = new Date(localCalendar.getTime() + offset * 86_400_000);
    const isoWeekday = candidateCalendar.getUTCDay() === 0 ? 7 : candidateCalendar.getUTCDay();
    if (!normalized.days.has(isoWeekday)) continue;
    if (offset === 0 && minuteOfDay >= endMinute) continue;
    const candidate = zonedDateTimeToUtc(
      candidateCalendar.getUTCFullYear(),
      candidateCalendar.getUTCMonth() + 1,
      candidateCalendar.getUTCDate(),
      normalized.activeHoursStart,
      normalized.timezone,
    );
    if (candidate.getTime() > nowMs) return { allowed: false, nextAt: candidate.toISOString() };
  }
  return { allowed: false, nextAt: new Date(nowMs + 24 * 3600 * 1000).toISOString() };
}
