import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { actorCanAccessWorkspace, requireApiActor, type ApiActor } from "@/lib/authz";
import { applyCalendarSchema } from "@/lib/calendar/schema";
import { CalendarConflictError, approveMeetingRequest, getMeetingRequest } from "@/lib/calendar/calendar-service";

/**
 * Human approval of an SDR-IA meeting request. This is the only path that turns a
 * proposal into a real booking, which keeps the agent in `approval` mode.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor: ApiActor | null = await requireApiActor(req, res);
  if (!actor) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "ID de solicitud requerido" });
  }

  const db = getDb();
  applyCalendarSchema(db);

  const request = getMeetingRequest(db, id);
  if (!request || !actorCanAccessWorkspace(actor, request.workspace_owner_id)) {
    return res.status(404).json({ error: "Solicitud no encontrada" });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const start_time = typeof body.start_time === "string" ? body.start_time : null;
  const end_time = typeof body.end_time === "string" ? body.end_time : null;

  if (!start_time || !end_time) {
    return res.status(400).json({ error: "start_time y end_time son obligatorios" });
  }
  if (new Date(end_time).getTime() <= new Date(start_time).getTime()) {
    return res.status(400).json({ error: "La hora de fin debe ser posterior a la de inicio" });
  }

  try {
    const result = approveMeetingRequest(db, id, {
      start_time,
      end_time,
      title: typeof body.title === "string" ? body.title : undefined,
      meeting_link: typeof body.meeting_link === "string" ? body.meeting_link : null,
      actorUserId: actor.id,
      workspaceOwnerId: actor.workspaceOwnerId,
    });
    return res.json({ request: result.request, event: result.event });
  } catch (err: unknown) {
    if (err instanceof CalendarConflictError) {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    console.error("[calendar/requests/approve] error:", err);
    const message = err instanceof Error ? err.message : "No se pudo agendar la reunión";
    return res.status(400).json({ error: message });
  }
}
