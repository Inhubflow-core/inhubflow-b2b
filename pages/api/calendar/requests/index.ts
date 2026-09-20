import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor, type ApiActor } from "@/lib/authz";
import { applyCalendarSchema } from "@/lib/calendar/schema";
import { listMeetingRequests } from "@/lib/calendar/calendar-service";

/**
 * Pending meeting requests raised by the SDR IA. Listing is read-only; the human
 * approves one slot via /api/calendar/requests/[id]/approve.
 *
 * The query joins the target so the UI can show who asked for the meeting.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor: ApiActor | null = await requireApiActor(req, res);
  if (!actor) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const db = getDb();
  applyCalendarSchema(db);

  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const allowed = new Set(["pending", "scheduled", "declined", "expired"]);

  const requests = listMeetingRequests(db, {
    workspaceOwnerId: actor.workspaceOwnerId,
    status: status && allowed.has(status) ? (status as never) : undefined,
  });

  if (requests.length === 0) return res.json({ requests: [] });

  const targetIds = [...new Set(requests.map((r) => r.target_id).filter((v): v is string => Boolean(v)))];
  const targets = new Map<string, { full_name: string | null; company: string | null; email: string | null }>();
  if (targetIds.length > 0) {
    const rows = db
      .prepare(
        `SELECT id, full_name, company, email FROM targets
         WHERE id IN (${targetIds.map(() => "?").join(",")})`
      )
      .all(...targetIds) as Array<{ id: string; full_name: string | null; company: string | null; email: string | null }>;
    for (const row of rows) targets.set(row.id, row);
  }

  return res.json({
    requests: requests.map((r) => ({
      ...r,
      target: r.target_id ? (targets.get(r.target_id) ?? null) : null,
      proposed_slots: safeParseSlots(r.proposed_slots_json),
    })),
  });
}

function safeParseSlots(json: string): unknown[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
