import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor, type ApiActor } from "@/lib/authz";
import { applyCalendarSchema } from "@/lib/calendar/schema";
import {
  CalendarConflictError,
  createCalendarEvent,
  getCalendarEvents,
  type CreateCalendarEventInput,
} from "@/lib/calendar/calendar-service";
import { CALENDAR_CHANNELS, CALENDAR_STATUSES } from "@/lib/calendar/schema";

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pickStatus(value: unknown): CreateCalendarEventInput["status"] {
  return (CALENDAR_STATUSES as readonly string[]).includes(String(value))
    ? (value as CreateCalendarEventInput["status"])
    : "confirmed";
}

function pickChannel(value: unknown): CreateCalendarEventInput["channel"] {
  return (CALENDAR_CHANNELS as readonly string[]).includes(String(value))
    ? (value as CreateCalendarEventInput["channel"])
    : "manual";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor: ApiActor | null = await requireApiActor(req, res);
  if (!actor) return;

  const db = getDb();
  applyCalendarSchema(db);

  if (req.method === "GET") {
    try {
      const { start, end, status, target_id, run_id, list_id, workflow_id } = req.query;

      const events = getCalendarEvents(db, {
        startDate: str(start),
        endDate: str(end),
        status: str(status),
        targetId: str(target_id),
        runId: str(run_id),
        listId: str(list_id),
        workflowId: str(workflow_id),
        workspaceOwnerId: actor.workspaceOwnerId,
      });

      return res.json({ events });
    } catch (err: unknown) {
      console.error("[calendar/events] GET error:", err);
      return res.status(500).json({ error: "Failed to fetch calendar events" });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body ?? {};
      const {
        title,
        description,
        start_time,
        end_time,
        target_id,
        meeting_link,
        location,
        status,
        channel,
        auto_advance_pipeline,
        run_id,
        list_id,
        thread_id,
        decision_id,
        source,
      } = body;

      if (!title || typeof title !== "string" || !title.trim()) {
        return res.status(400).json({ error: "Título de la reunión requerido" });
      }
      if (!start_time || typeof start_time !== "string") {
        return res.status(400).json({ error: "Hora de inicio requerida" });
      }
      if (!end_time || typeof end_time !== "string") {
        return res.status(400).json({ error: "Hora de fin requerida" });
      }
      if (new Date(end_time).getTime() <= new Date(start_time).getTime()) {
        return res.status(400).json({ error: "La hora de fin debe ser posterior a la de inicio" });
      }

      const input: CreateCalendarEventInput = {
        title: title.trim(),
        description: typeof description === "string" ? description.trim() : null,
        start_time,
        end_time,
        target_id: str(target_id) ?? null,
        meeting_link: str(meeting_link) ?? null,
        location: str(location) ?? null,
        status: pickStatus(status),
        channel: pickChannel(channel),
        created_by: actor.id,
        workspace_owner_id: actor.workspaceOwnerId,
        auto_advance_pipeline: auto_advance_pipeline !== false,
        run_id: str(run_id) ?? null,
        list_id: str(list_id) ?? null,
        thread_id: str(thread_id) ?? null,
        decision_id: str(decision_id) ?? null,
        source: str(source) ?? "manual",
      };

      const event = createCalendarEvent(db, input, {
        actorUserId: actor.id,
        workspaceOwnerId: actor.workspaceOwnerId,
      });
      return res.status(201).json({ event });
    } catch (err: unknown) {
      if (err instanceof CalendarConflictError) {
        return res.status(409).json({ error: err.message, code: err.code });
      }
      console.error("[calendar/events] POST error:", err);
      const message = err instanceof Error ? err.message : "Failed to create calendar event";
      return res.status(400).json({ error: message });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
