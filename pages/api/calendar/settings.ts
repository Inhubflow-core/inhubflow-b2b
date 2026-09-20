import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor, type ApiActor } from "@/lib/authz";
import { applyCalendarSchema } from "@/lib/calendar/schema";
import {
  ensureFeedToken,
  getCalendarSettings,
  rotateFeedToken,
  saveCalendarSettings,
} from "@/lib/calendar/settings";
import { normalizeTimeZone } from "@/lib/calendar/time";

const DURATIONS = [15, 30, 45, 60, 90];
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function sanitizeWorkingHours(value: unknown): string | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;

  const out: Record<string, Array<{ start: string; end: string }>> = {};
  for (const key of DAY_KEYS) {
    const raw = (value as Record<string, unknown>)[key];
    const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
    out[key] = list
      .map((interval) => {
        if (!interval || typeof interval !== "object") return null;
        const start = (interval as { start?: unknown }).start;
        const end = (interval as { end?: unknown }).end;
        if (typeof start !== "string" || typeof end !== "string") return null;
        if (!/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) return null;
        return { start, end };
      })
      .filter((x): x is { start: string; end: string } => x !== null);
  }
  return JSON.stringify(out);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor: ApiActor | null = await requireApiActor(req, res);
  if (!actor) return;

  const db = getDb();
  applyCalendarSchema(db);

  // Settings are per workspace: each tenant configures its own hours and links.
  const workspaceOwnerId = actor.workspaceOwnerId;

  if (req.method === "GET") {
    try {
      const settings = getCalendarSettings(db, workspaceOwnerId);
      const feedToken = ensureFeedToken(db, workspaceOwnerId);
      const origin = (req.headers.host ? `${req.headers["x-forwarded-proto"] ?? "https"}://${req.headers.host}` : "");
      return res.json({
        settings,
        feedUrl: feedToken ? `${origin}/api/calendar/feed?token=${feedToken}` : null,
        bookingUrl: origin ? `${origin}/book` : "/book",
      });
    } catch (err: unknown) {
      console.error("[calendar/settings] GET error:", err);
      return res.status(500).json({ error: "Failed to fetch calendar settings" });
    }
  }

  if (req.method === "POST" || req.method === "PUT") {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;

      // Rotation-only request: mint a fresh token and return the new URL.
      if (body.rotate_feed_token === true) {
        rotateFeedToken(db, workspaceOwnerId);
        const settings = getCalendarSettings(db, workspaceOwnerId);
        const origin = req.headers.host
          ? `${req.headers["x-forwarded-proto"] ?? "https"}://${req.headers.host}`
          : "";
        return res.json({
          settings,
          feedUrl: settings.feed_token ? `${origin}/api/calendar/feed?token=${settings.feed_token}` : null,
        });
      }

      const workingHours = sanitizeWorkingHours(body.working_hours_json ?? body.workingHours);

      const settings = saveCalendarSettings(
        db,
        {
          slot_duration_minutes: asInt(body.slot_duration_minutes, 30, 5, 480),
          buffer_time_minutes: asInt(body.buffer_time_minutes, 15, 0, 240),
          min_notice_hours: asInt(body.min_notice_hours, 4, 0, 720),
          timezone: normalizeTimeZone(typeof body.timezone === "string" ? body.timezone : null),
          ...(workingHours ? { working_hours_json: workingHours } : {}),
          ...(typeof body.default_meeting_link === "string"
            ? { default_meeting_link: body.default_meeting_link.trim() || null }
            : {}),
        },
        workspaceOwnerId
      );

      const feedToken = ensureFeedToken(db, workspaceOwnerId);
      const origin = req.headers.host ? `${req.headers["x-forwarded-proto"] ?? "https"}://${req.headers.host}` : "";
      return res.json({
        settings,
        feedUrl: feedToken ? `${origin}/api/calendar/feed?token=${feedToken}` : null,
      });
    } catch (err: unknown) {
      console.error("[calendar/settings] POST/PUT error:", err);
      return res.status(500).json({ error: "Failed to save calendar settings" });
    }
  }

  res.setHeader("Allow", ["GET", "POST", "PUT"]);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
