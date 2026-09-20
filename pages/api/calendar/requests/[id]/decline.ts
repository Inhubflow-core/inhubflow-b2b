import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { actorCanAccessWorkspace, requireApiActor, type ApiActor } from "@/lib/authz";
import { applyCalendarSchema } from "@/lib/calendar/schema";
import { getMeetingRequest, resolveMeetingRequest } from "@/lib/calendar/calendar-service";

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

  try {
    const updated = resolveMeetingRequest(db, id, "declined", {
      actorUserId: actor.id,
      workspaceOwnerId: actor.workspaceOwnerId,
    });
    return res.json({ request: updated });
  } catch (err: unknown) {
    console.error("[calendar/requests/decline] error:", err);
    return res.status(400).json({ error: "No se pudo rechazar la solicitud" });
  }
}
