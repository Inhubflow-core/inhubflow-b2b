import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { actorCanAccessWorkspace, requireApiActor, type ApiActor } from "@/lib/authz";
import { applyCalendarSchema } from "@/lib/calendar/schema";
import {
  CalendarConflictError,
  deleteCalendarEvent,
  getCalendarEventById,
  updateCalendarEvent,
  type UpdateCalendarEventInput,
} from "@/lib/calendar/calendar-service";
import { listCalendarAudit } from "@/lib/calendar/audit";

const STATUSES = new Set(["confirmed", "completed", "cancelled", "no_show"]);
const CHANNELS = new Set(["linkedin", "email", "manual", "sdr_ai"]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor: ApiActor | null = await requireApiActor(req, res);
  if (!actor) return;

  const { id } = req.query;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "ID de evento requerido" });
  }

  const db = getDb();
  applyCalendarSchema(db);

  const event = getCalendarEventById(db, id);
  if (!event) {
    return res.status(404).json({ error: "Evento no encontrado" });
  }

  // Ownership check. Rows written before workspace scoping existed have a NULL
  // owner: they stay readable, but only an admin may modify them so one tenant
  // can never cancel another's meetings.
  const legacyRow = event.workspace_owner_id === null;
  if (!legacyRow && !actorCanAccessWorkspace(actor, event.workspace_owner_id)) {
    return res.status(404).json({ error: "Evento no encontrado" });
  }

  if (req.method === "GET") {
    return res.json({
      event,
      audit: listCalendarAudit(db, { eventId: id, limit: 50 }),
    });
  }

  if (req.method === "PUT") {
    if (legacyRow && !actor.isSuperAdmin) {
      return res.status(403).json({ error: "Sólo un administrador puede modificar reuniones sin propietario" });
    }
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input: UpdateCalendarEventInput = {};

      if (typeof body.title === "string" && body.title.trim()) input.title = body.title;
      if (typeof body.description === "string") input.description = body.description.trim();
      if (typeof body.start_time === "string") input.start_time = body.start_time;
      if (typeof body.end_time === "string") input.end_time = body.end_time;
      if (body.target_id === null || typeof body.target_id === "string") {
        input.target_id = body.target_id as string | null;
      }
      if (body.meeting_link === null || typeof body.meeting_link === "string") {
        input.meeting_link = body.meeting_link as string | null;
      }
      if (body.location === null || typeof body.location === "string") {
        input.location = body.location as string | null;
      }
      if (typeof body.status === "string") {
        if (!STATUSES.has(body.status)) {
          return res.status(400).json({ error: "Estado de reunión inválido" });
        }
        input.status = body.status as UpdateCalendarEventInput["status"];
      }
      if (typeof body.channel === "string") {
        if (!CHANNELS.has(body.channel)) {
          return res.status(400).json({ error: "Canal inválido" });
        }
        input.channel = body.channel as UpdateCalendarEventInput["channel"];
      }
      if (body.run_id === null || typeof body.run_id === "string") {
        input.run_id = body.run_id as string | null;
      }
      if (body.list_id === null || typeof body.list_id === "string") {
        input.list_id = body.list_id as string | null;
      }
      if (body.thread_id === null || typeof body.thread_id === "string") {
        input.thread_id = body.thread_id as string | null;
      }
      if (body.decision_id === null || typeof body.decision_id === "string") {
        input.decision_id = body.decision_id as string | null;
      }

      if (Object.keys(input).length === 0) {
        return res.status(400).json({ error: "Nada que actualizar" });
      }

      const updated = updateCalendarEvent(db, id, input, {
        actorUserId: actor.id,
        workspaceOwnerId: actor.workspaceOwnerId,
      });
      if (!updated) return res.status(404).json({ error: "Evento no encontrado" });
      return res.json({ event: updated });
    } catch (err: unknown) {
      if (err instanceof CalendarConflictError) {
        return res.status(409).json({ error: err.message, code: err.code });
      }
      console.error("[calendar/events/[id]] PUT error:", err);
      const message = err instanceof Error ? err.message : "Failed to update calendar event";
      return res.status(400).json({ error: message });
    }
  }

  if (req.method === "DELETE") {
    if (legacyRow && !actor.isSuperAdmin) {
      return res.status(403).json({ error: "Sólo un administrador puede eliminar reuniones sin propietario" });
    }
    try {
      const success = deleteCalendarEvent(db, id, {
        actorUserId: actor.id,
        workspaceOwnerId: actor.workspaceOwnerId,
      });
      if (!success) return res.status(404).json({ error: "Evento no encontrado" });
      return res.json({ ok: true });
    } catch (err: unknown) {
      console.error("[calendar/events/[id]] DELETE error:", err);
      return res.status(500).json({ error: "Failed to delete calendar event" });
    }
  }

  res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
