import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { applyCalendarSchema } from "@/lib/calendar/schema";
import { getCalendarSettings } from "@/lib/calendar/settings";
import { getCalendarEvents } from "@/lib/calendar/calendar-service";

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function formatIcsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * iCal subscription feed.
 *
 * The calendar exposes meeting times, so it requires the workspace feed token —
 * without it any anonymous caller could enumerate the sales agenda. The token is
 * shown in the settings modal and rotation is a single settings save away.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).send("Method not allowed");
  }

  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token) {
    return res.status(401).send("Token de suscripción requerido");
  }

  const db = getDb();
  applyCalendarSchema(db);

  const owner = db
    .prepare("SELECT workspace_owner_id FROM calendar_settings WHERE feed_token = ?")
    .get(token) as { workspace_owner_id: string | null } | undefined;

  if (!owner) {
    return res.status(401).send("Token de suscripción inválido");
  }

  const settings = getCalendarSettings(db, owner.workspace_owner_id);

  try {
    // Past 30 days to 90 days ahead.
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 30);
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 90);

    const events = getCalendarEvents(db, {
      startDate: pastDate.toISOString(),
      endDate: futureDate.toISOString(),
      workspaceOwnerId: owner.workspace_owner_id,
    });

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//InHubFlow//Calendar Feed//ES",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:InHubFlow - Reuniones Comerciales",
      `X-WR-TIMEZONE:${settings.timezone}`,
    ];

    for (const evt of events) {
      if (evt.status === "cancelled") continue;

      const dtStamp = formatIcsDate(evt.updated_at || evt.created_at || evt.start_time);
      const dtStart = formatIcsDate(evt.start_time);
      const dtEnd = formatIcsDate(evt.end_time);
      const uid = `${evt.id}@inhubflow.com`;

      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${dtStamp}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `SUMMARY:${escapeIcs(evt.title)}`,
        `STATUS:${evt.status === "completed" ? "CONFIRMED" : "TENTATIVE"}`,
        "TRANSP:OPAQUE"
      );

      const parts: string[] = [];
      if (evt.target_name) parts.push(`Prospecto: ${evt.target_name}`);
      if (evt.target_company) parts.push(`Empresa: ${evt.target_company}`);
      if (evt.run_name) parts.push(`Campaña: ${evt.run_name}`);
      if (evt.description || evt.target_email) {
        const body = evt.description || "Reunión programada en InHubFlow.";
        if (evt.target_email) parts.push(`Contacto: ${evt.target_email}`);
        parts.push(body);
      }
      lines.push(`DESCRIPTION:${escapeIcs(parts.join("\n"))}`);

      // The feed carries no attendee emails: publishing a prospect's address on a
      // URL anyone with the token could fetch would leak CRM data.
      const location = evt.meeting_link || evt.location;
      if (location) lines.push(`LOCATION:${escapeIcs(location)}`);

      if (evt.status === "no_show") lines.push("X-INHUBFLOW-STATUS:NO_SHOW");

      lines.push("END:VEVENT");
    }

    lines.push("END:VCALENDAR");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="inhubflow-calendar.ics"');
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

    return res.send(lines.join("\r\n"));
  } catch (err: unknown) {
    console.error("[calendar/feed] error:", err);
    return res.status(500).send("Error generando el feed iCal");
  }
}
