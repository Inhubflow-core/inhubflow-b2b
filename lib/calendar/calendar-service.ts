import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { autoAdvanceTargetByTrigger } from "@/lib/pipeline/pipeline-service";
import { recordCalendarAudit } from "./audit";
import { findSlotCollision } from "./availability";
import type {
  CalendarEvent,
  CalendarMeetingRequest,
  CalendarSettings,
  MeetingRequestStatus,
} from "./schema";

export interface CalendarEventWithTarget extends CalendarEvent {
  target_name?: string | null;
  target_company?: string | null;
  target_title?: string | null;
  target_email?: string | null;
  target_linkedin_url?: string | null;
  target_location?: string | null;
  target_image_url?: string | null;
  // Ecosystem context exposed to the UI: which campaign / list / thread.
  run_name?: string | null;
  list_name?: string | null;
  list_names?: string[];
  workflow_names?: string[];
}

export interface CreateCalendarEventInput {
  title: string;
  description?: string | null;
  start_time: string; // ISO8601 UTC
  end_time: string;   // ISO8601 UTC
  target_id?: string | null;
  meeting_link?: string | null;
  location?: string | null;
  status?: "confirmed" | "completed" | "cancelled" | "no_show";
  channel?: "linkedin" | "email" | "manual" | "sdr_ai";
  created_by?: string | null;
  workspace_owner_id?: string | null;
  auto_advance_pipeline?: boolean;
  // Ecosystem linkage
  run_id?: string | null;
  list_id?: string | null;
  thread_id?: string | null;
  decision_id?: string | null;
  source?: string | null;
}

export interface UpdateCalendarEventInput {
  title?: string;
  description?: string | null;
  start_time?: string;
  end_time?: string;
  target_id?: string | null;
  meeting_link?: string | null;
  location?: string | null;
  status?: "confirmed" | "completed" | "cancelled" | "no_show";
  channel?: "linkedin" | "email" | "manual" | "sdr_ai";
  run_id?: string | null;
  list_id?: string | null;
  thread_id?: string | null;
  decision_id?: string | null;
  source?: string | null;
}

export interface CalendarEventFilter {
  startDate?: string;
  endDate?: string;
  targetId?: string;
  status?: string;
  /** Workspace scoping: events owned by the workspace plus unowned legacy rows. */
  workspaceOwnerId?: string | null;
  /** Restrict to a campaign run / list, mirroring the pipeline filters. */
  runId?: string;
  listId?: string;
  /** Restrict to meetings whose prospect belongs to a campaign / list. */
  workflowId?: string;
}

const TARGET_JOIN = `
  LEFT JOIN targets t ON t.id = ce.target_id
`;

const TARGET_COLUMNS = `
  t.full_name as target_name,
  t.company as target_company,
  t.title as target_title,
  t.email as target_email,
  t.linkedin_url as target_linkedin_url,
  t.location as target_location,
  t.profile_image_url as target_image_url
`;

/**
 * Fetch calendar events within an optional date range or for a specific target.
 * Always scoped to a workspace (legacy rows with NULL owner stay visible).
 */
export function getCalendarEvents(
  db: Database.Database,
  filter?: CalendarEventFilter
): CalendarEventWithTarget[] {
  const params: unknown[] = [];
  const clauses: string[] = ["1=1"];

  if (filter?.startDate) {
    clauses.push("ce.end_time >= ?");
    params.push(filter.startDate);
  }
  if (filter?.endDate) {
    clauses.push("ce.start_time <= ?");
    params.push(filter.endDate);
  }
  if (filter?.targetId) {
    clauses.push("ce.target_id = ?");
    params.push(filter.targetId);
  }
  if (filter?.status && filter.status !== "all") {
    clauses.push("ce.status = ?");
    params.push(filter.status);
  }
  if (filter?.workspaceOwnerId) {
    clauses.push("(ce.workspace_owner_id = ? OR ce.workspace_owner_id IS NULL)");
    params.push(filter.workspaceOwnerId);
  }
  if (filter?.runId) {
    clauses.push("ce.run_id = ?");
    params.push(filter.runId);
  }
  if (filter?.listId) {
    clauses.push(`(
      ce.list_id = ?
      OR EXISTS (SELECT 1 FROM list_targets lt WHERE lt.list_id = ? AND lt.target_id = ce.target_id)
    )`);
    params.push(filter.listId, filter.listId);
  }
  if (filter?.workflowId) {
    clauses.push(`(
      EXISTS (
        SELECT 1 FROM runs r
        WHERE r.workflow_id = ? AND r.id = ce.run_id
      )
      OR EXISTS (
        SELECT 1 FROM run_profiles rp
        JOIN runs r2 ON r2.id = rp.run_id
        WHERE r2.workflow_id = ? AND rp.target_id = ce.target_id
      )
    )`);
    params.push(filter.workflowId, filter.workflowId);
  }

  const query = `
    SELECT ce.*, ${TARGET_COLUMNS}
    FROM calendar_events ce
    ${TARGET_JOIN}
    WHERE ${clauses.join(" AND ")}
    ORDER BY ce.start_time ASC
  `;

  const rows = db.prepare(query).all(...params) as CalendarEventWithTarget[];
  return decorateEcosystemContext(db, rows);
}

/** Attaches campaign/list names in one batched pass (no per-row queries). */
export function decorateEcosystemContext(
  db: Database.Database,
  events: CalendarEventWithTarget[],
): CalendarEventWithTarget[] {
  if (events.length === 0) return events;

  const runIds = [...new Set(events.map((e) => e.run_id).filter((v): v is string => Boolean(v)))];
  const listIds = [...new Set(events.map((e) => e.list_id).filter((v): v is string => Boolean(v)))];
  const targetIds = [...new Set(events.map((e) => e.target_id).filter((v): v is string => Boolean(v)))];

  const runNames = new Map<string, string>();
  if (runIds.length > 0) {
    const rows = db
      .prepare(
        `SELECT r.id, w.name AS workflow_name
         FROM runs r LEFT JOIN workflows w ON w.id = r.workflow_id
         WHERE r.id IN (${runIds.map(() => "?").join(",")})`
      )
      .all(...runIds) as Array<{ id: string; workflow_name: string | null }>;
    for (const row of rows) runNames.set(row.id, row.workflow_name ?? "Campaña");
  }

  const listNames = new Map<string, string>();
  if (listIds.length > 0) {
    const rows = db
      .prepare(`SELECT id, name FROM lists WHERE id IN (${listIds.map(() => "?").join(",")})`)
      .all(...listIds) as Array<{ id: string; name: string }>;
    for (const row of rows) listNames.set(row.id, row.name);
  }

  // Leads' own memberships, so a meeting opened from the pipeline shows context.
  const targetLists = new Map<string, string[]>();
  const targetWorkflows = new Map<string, string[]>();
  if (targetIds.length > 0) {
    const placeholders = targetIds.map(() => "?").join(",");
    const listRows = db
      .prepare(
        `SELECT lt.target_id, l.name FROM list_targets lt
         JOIN lists l ON l.id = lt.list_id
         WHERE lt.target_id IN (${placeholders})`
      )
      .all(...targetIds) as Array<{ target_id: string; name: string }>;
    for (const row of listRows) {
      const arr = targetLists.get(row.target_id) ?? [];
      if (!arr.includes(row.name)) arr.push(row.name);
      targetLists.set(row.target_id, arr);
    }

    const wfRows = db
      .prepare(
        `SELECT rp.target_id, w.name FROM run_profiles rp
         JOIN runs r ON r.id = rp.run_id
         JOIN workflows w ON w.id = r.workflow_id
         WHERE rp.target_id IN (${placeholders})`
      )
      .all(...targetIds) as Array<{ target_id: string; name: string }>;
    for (const row of wfRows) {
      const arr = targetWorkflows.get(row.target_id) ?? [];
      if (!arr.includes(row.name)) arr.push(row.name);
      targetWorkflows.set(row.target_id, arr);
    }
  }

  for (const event of events) {
    event.run_name = event.run_id ? (runNames.get(event.run_id) ?? null) : null;
    event.list_name = event.list_id ? (listNames.get(event.list_id) ?? null) : null;
    event.list_names = event.target_id ? (targetLists.get(event.target_id) ?? []) : [];
    event.workflow_names = event.target_id ? (targetWorkflows.get(event.target_id) ?? []) : [];
  }

  return events;
}

/** Fetch a single event by ID with target details. */
export function getCalendarEventById(
  db: Database.Database,
  id: string
): CalendarEventWithTarget | null {
  const row = db
    .prepare(
      `SELECT ce.*, ${TARGET_COLUMNS}
       FROM calendar_events ce
       ${TARGET_JOIN}
       WHERE ce.id = ?`
    )
    .get(id) as CalendarEventWithTarget | undefined;
  if (!row) return null;
  return decorateEcosystemContext(db, [row])[0];
}

function assertValidRange(startIso: string, endIso: string): void {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error("Rango de fechas inválido");
  }
  if (end <= start) {
    throw new Error("La hora de fin debe ser posterior a la de inicio");
  }
}

export class CalendarConflictError extends Error {
  readonly code = "slot_taken";
  constructor(message = "El horario seleccionado ya no está disponible") {
    super(message);
    this.name = "CalendarConflictError";
  }
}

/**
 * Create a new calendar event, advancing the lead to "Reunión Agendada" and
 * writing the audit trail. Rejects double bookings for confirmed/completed rows.
 */
export function createCalendarEvent(
  db: Database.Database,
  input: CreateCalendarEventInput,
  actor?: { actorUserId?: string | null; workspaceOwnerId?: string | null }
): CalendarEventWithTarget {
  assertValidRange(input.start_time, input.end_time);

  const id = `evt_${randomUUID()}`;
  const now = new Date().toISOString();
  const status = input.status || "confirmed";
  const channel = input.channel || "manual";
  const workspaceOwnerId = input.workspace_owner_id ?? actor?.workspaceOwnerId ?? null;

  const conflicts = status === "confirmed" || status === "completed";
  if (conflicts) {
    const collision = findSlotCollision(
      db,
      new Date(input.start_time).getTime(),
      new Date(input.end_time).getTime(),
      { workspaceOwnerId },
    );
    if (collision) throw new CalendarConflictError();
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO calendar_events (
        id, title, description, start_time, end_time, target_id,
        meeting_link, location, status, channel, created_by,
        workspace_owner_id, run_id, list_id, thread_id, decision_id, source,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.title.trim(),
      input.description || null,
      input.start_time,
      input.end_time,
      input.target_id || null,
      input.meeting_link || null,
      input.location || null,
      status,
      channel,
      input.created_by || actor?.actorUserId || null,
      workspaceOwnerId,
      input.run_id || null,
      input.list_id || null,
      input.thread_id || null,
      input.decision_id || null,
      input.source || null,
      now,
      now
    );

    // Auto-advance prospect in Pipeline if enabled (defaults to true if target provided)
    if (input.target_id && input.auto_advance_pipeline !== false) {
      try {
        autoAdvanceTargetByTrigger(db, input.target_id, "sdr_meeting");
      } catch (err) {
        console.error("Failed to advance target in pipeline:", err);
      }
    }

    recordCalendarAudit(db, {
      eventId: id,
      workspaceOwnerId,
      action: "created",
      actorUserId: input.created_by || actor?.actorUserId || null,
      detail: {
        title: input.title.trim(),
        start_time: input.start_time,
        end_time: input.end_time,
        target_id: input.target_id ?? null,
        channel,
        source: input.source ?? null,
        status,
      },
    });
  })();

  return getCalendarEventById(db, id)!;
}

/** Update an existing calendar event. Re-checks collisions when the time moves. */
export function updateCalendarEvent(
  db: Database.Database,
  id: string,
  input: UpdateCalendarEventInput,
  actor?: { actorUserId?: string | null; workspaceOwnerId?: string | null }
): CalendarEventWithTarget | null {
  const existing = getCalendarEventById(db, id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const fields: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];

  if (input.title !== undefined) {
    fields.push("title = ?");
    params.push(input.title.trim());
  }
  if (input.description !== undefined) {
    fields.push("description = ?");
    params.push(input.description);
  }
  if (input.start_time !== undefined) {
    fields.push("start_time = ?");
    params.push(input.start_time);
  }
  if (input.end_time !== undefined) {
    fields.push("end_time = ?");
    params.push(input.end_time);
  }
  if (input.target_id !== undefined) {
    fields.push("target_id = ?");
    params.push(input.target_id);
  }
  if (input.meeting_link !== undefined) {
    fields.push("meeting_link = ?");
    params.push(input.meeting_link);
  }
  if (input.location !== undefined) {
    fields.push("location = ?");
    params.push(input.location);
  }
  if (input.status !== undefined) {
    fields.push("status = ?");
    params.push(input.status);
  }
  if (input.channel !== undefined) {
    fields.push("channel = ?");
    params.push(input.channel);
  }
  if (input.run_id !== undefined) {
    fields.push("run_id = ?");
    params.push(input.run_id);
  }
  if (input.list_id !== undefined) {
    fields.push("list_id = ?");
    params.push(input.list_id);
  }
  if (input.thread_id !== undefined) {
    fields.push("thread_id = ?");
    params.push(input.thread_id);
  }
  if (input.decision_id !== undefined) {
    fields.push("decision_id = ?");
    params.push(input.decision_id);
  }
  if (input.source !== undefined) {
    fields.push("source = ?");
    params.push(input.source);
  }

  const nextStart = input.start_time ?? existing.start_time;
  const nextEnd = input.end_time ?? existing.end_time;
  assertValidRange(nextStart, nextEnd);

  const nextStatus = input.status ?? existing.status;
  if (nextStatus === "confirmed" || nextStatus === "completed") {
    const collision = findSlotCollision(
      db,
      new Date(nextStart).getTime(),
      new Date(nextEnd).getTime(),
      { excludeEventId: id, workspaceOwnerId: existing.workspace_owner_id ?? actor?.workspaceOwnerId ?? null },
    );
    if (collision) throw new CalendarConflictError();
  }

  params.push(id);
  db.transaction(() => {
    db.prepare(`UPDATE calendar_events SET ${fields.join(", ")} WHERE id = ?`).run(...params);

    // Adding a prospect later still advances the funnel (meeting scheduled late).
    if (input.target_id && input.target_id !== existing.target_id && input.status !== "cancelled") {
      try {
        autoAdvanceTargetByTrigger(db, input.target_id, "sdr_meeting");
      } catch (err) {
        console.error("Failed to advance target in pipeline:", err);
      }
    }

    const changedKeys = Object.keys(input).filter(
      (key) => (input as Record<string, unknown>)[key] !== undefined
    );
    recordCalendarAudit(db, {
      eventId: id,
      workspaceOwnerId: existing.workspace_owner_id ?? actor?.workspaceOwnerId ?? null,
      action: input.status && input.status !== existing.status ? `status:${input.status}` : "updated",
      actorUserId: actor?.actorUserId ?? null,
      detail: { fields: changedKeys, status: nextStatus },
    });
  })();

  return getCalendarEventById(db, id);
}

/** Delete a calendar event by ID. */
export function deleteCalendarEvent(
  db: Database.Database,
  id: string,
  actor?: { actorUserId?: string | null; workspaceOwnerId?: string | null }
): boolean {
  const existing = getCalendarEventById(db, id);
  if (!existing) return false;

  const changes = db.transaction(() => {
    recordCalendarAudit(db, {
      eventId: id,
      workspaceOwnerId: existing.workspace_owner_id ?? actor?.workspaceOwnerId ?? null,
      action: "deleted",
      actorUserId: actor?.actorUserId ?? null,
      detail: { title: existing.title, start_time: existing.start_time },
    });
    return db.prepare(`DELETE FROM calendar_events WHERE id = ?`).run(id).changes;
  })();

  return changes > 0;
}

/** Confirms/cancels an event and mirrors the outcome into the pipeline. */
export function setCalendarEventStatus(
  db: Database.Database,
  id: string,
  status: CalendarEvent["status"],
  actor?: { actorUserId?: string | null; workspaceOwnerId?: string | null }
): CalendarEventWithTarget | null {
  const updated = updateCalendarEvent(db, id, { status }, actor);
  if (!updated || !updated.target_id) return updated;

  // A no-show or a cancellation is a real commercial signal: the lead drops out
  // of "Reunión Agendada" but never loses a Won deal.
  if (status === "no_show" || status === "cancelled") {
    try {
      autoAdvanceTargetByTrigger(db, updated.target_id, "sdr_not_interested");
    } catch {
      // Non-blocking
    }
  } else if (status === "completed") {
    try {
      autoAdvanceTargetByTrigger(db, updated.target_id, "sdr_meeting");
    } catch {
      // Non-blocking
    }
  }

  return getCalendarEventById(db, id);
}

export interface CreateMeetingRequestInput {
  thread_id?: string | null;
  decision_id?: string | null;
  target_id?: string | null;
  duration_minutes?: number;
  proposed_slots: Array<{ start_time: string; end_time: string; label?: string }>;
  notes?: string | null;
  workspace_owner_id?: string | null;
}

/**
 * The SDR never books by itself: it records a request with candidate slots and a
 * human approves one. Keeps the agent in `approval` mode end-to-end.
 */
export function createMeetingRequest(
  db: Database.Database,
  input: CreateMeetingRequestInput
): CalendarMeetingRequest {
  const id = `mrq_${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO calendar_meeting_requests (
      id, workspace_owner_id, thread_id, decision_id, target_id,
      duration_minutes, proposed_slots_json, status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    id,
    input.workspace_owner_id ?? null,
    input.thread_id ?? null,
    input.decision_id ?? null,
    input.target_id ?? null,
    input.duration_minutes ?? 30,
    JSON.stringify(input.proposed_slots ?? []),
    input.notes ?? null,
    now,
    now
  );
  return getMeetingRequest(db, id)!;
}

export function getMeetingRequest(
  db: Database.Database,
  id: string
): CalendarMeetingRequest | null {
  const row = db
    .prepare("SELECT * FROM calendar_meeting_requests WHERE id = ?")
    .get(id) as CalendarMeetingRequest | undefined;
  return row ?? null;
}

export function listMeetingRequests(
  db: Database.Database,
  filter: { workspaceOwnerId?: string | null; status?: MeetingRequestStatus } = {}
): CalendarMeetingRequest[] {
  const clauses: string[] = ["1=1"];
  const params: unknown[] = [];
  if (filter.workspaceOwnerId) {
    clauses.push("(workspace_owner_id = ? OR workspace_owner_id IS NULL)");
    params.push(filter.workspaceOwnerId);
  }
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  return db
    .prepare(
      `SELECT * FROM calendar_meeting_requests
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC LIMIT 100`
    )
    .all(...params) as CalendarMeetingRequest[];
}

export interface ApproveMeetingRequestInput {
  start_time: string;
  end_time: string;
  title?: string;
  meeting_link?: string | null;
  channel?: CalendarEvent["channel"];
  actorUserId?: string | null;
  workspaceOwnerId?: string | null;
}

/** Approves a pending request, creating the real event (or linking an existing one). */
export function approveMeetingRequest(
  db: Database.Database,
  id: string,
  input: ApproveMeetingRequestInput
): { request: CalendarMeetingRequest; event: CalendarEventWithTarget } {
  const request = getMeetingRequest(db, id);
  if (!request) throw new Error("Solicitud de reunión no encontrada");
  if (request.status !== "pending") {
    throw new Error(`La solicitud ya fue ${request.status === "scheduled" ? "agendada" : "resuelta"}`);
  }

  const event = db.transaction(() => {
    const created = createCalendarEvent(
      db,
      {
        title: input.title?.trim() || requestTitle(db, request),
        description: request.notes ?? null,
        start_time: input.start_time,
        end_time: input.end_time,
        target_id: request.target_id ?? null,
        meeting_link: input.meeting_link ?? null,
        status: "confirmed",
        channel: input.channel ?? "sdr_ai",
        created_by: input.actorUserId ?? null,
        workspace_owner_id: request.workspace_owner_id ?? input.workspaceOwnerId ?? null,
        thread_id: request.thread_id,
        decision_id: request.decision_id,
        source: "sdr_ai",
        auto_advance_pipeline: true,
      },
      { actorUserId: input.actorUserId ?? null, workspaceOwnerId: request.workspace_owner_id }
    );

    db.prepare(`
      UPDATE calendar_meeting_requests
      SET status = 'scheduled', created_event_id = ?, decided_by = ?, decided_at = ?, updated_at = ?
      WHERE id = ?
    `).run(created.id, input.actorUserId ?? null, new Date().toISOString(), new Date().toISOString(), id);

    recordCalendarAudit(db, {
      eventId: created.id,
      workspaceOwnerId: request.workspace_owner_id,
      action: "request_approved",
      actorUserId: input.actorUserId ?? null,
      detail: { request_id: id, thread_id: request.thread_id, decision_id: request.decision_id },
    });

    return created;
  })();

  return { request: getMeetingRequest(db, id)!, event };
}

function requestTitle(db: Database.Database, request: CalendarMeetingRequest): string {
  if (!request.target_id) return "Reunión Comercial";
  const row = db.prepare("SELECT full_name, company FROM targets WHERE id = ?").get(request.target_id) as
    | { full_name: string | null; company: string | null }
    | undefined;
  const name = row?.full_name || "Prospecto";
  return row?.company ? `Reunión con ${name} (${row.company})` : `Reunión con ${name}`;
}

export function resolveMeetingRequest(
  db: Database.Database,
  id: string,
  status: Exclude<MeetingRequestStatus, "pending">,
  actor?: { actorUserId?: string | null; workspaceOwnerId?: string | null }
): CalendarMeetingRequest | null {
  const request = getMeetingRequest(db, id);
  if (!request) return null;
  db.prepare(`
    UPDATE calendar_meeting_requests
    SET status = ?, decided_by = ?, decided_at = ?, updated_at = ?
    WHERE id = ?
  `).run(status, actor?.actorUserId ?? null, new Date().toISOString(), new Date().toISOString(), id);

  recordCalendarAudit(db, {
    eventId: null,
    workspaceOwnerId: request.workspace_owner_id ?? actor?.workspaceOwnerId ?? null,
    action: `request_${status}`,
    actorUserId: actor?.actorUserId ?? null,
    detail: { request_id: id, target_id: request.target_id },
  });

  return getMeetingRequest(db, id);
}

export type { CalendarEvent, CalendarMeetingRequest, CalendarSettings };
