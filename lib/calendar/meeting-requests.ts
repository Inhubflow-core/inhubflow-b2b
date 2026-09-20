import type Database from "better-sqlite3";
import {
  createMeetingRequest,
  type CalendarMeetingRequest,
} from "./calendar-service";
import { suggestSlots } from "./availability";

export interface MeetingRequestDeps {
  getDatabase?: () => Database.Database;
}

export interface ProposeMeetingInput {
  threadId: string | null;
  decisionId: string | null;
  targetId: string;
  workspaceOwnerId: string | null;
  durationMinutes?: number;
  notes?: string | null;
}

export interface MeetingProposalResult {
  requested: boolean;
  reason: "created" | "disabled" | "no_slots" | "error";
  requestId: string | null;
  slots: Array<{ start_time: string; end_time: string; label: string }>;
}

/**
 * Bridge used by the SDR orchestrator when it detects a meeting intent.
 *
 * The agent must never create the event itself — InHubFlow runs in `approval`
 * mode — so it records a request with candidate slots and a human picks one
 * from /calendar or via POST /api/calendar/requests/[id]/approve.
 *
 * Disabled unless NATIVE_CALENDAR_ENABLED is set, matching the runtime gate the
 * SDR already consults before offering slots.
 */
export function nativeCalendarEnabled(): boolean {
  return (
    process.env.NATIVE_CALENDAR_ENABLED === "true" ||
    process.env.NATIVE_CALENDAR_ENABLED === "1"
  );
}

export function proposeMeetingSlots(
  db: Database.Database,
  input: ProposeMeetingInput
): MeetingProposalResult {
  if (!nativeCalendarEnabled()) {
    return { requested: false, reason: "disabled", requestId: null, slots: [] };
  }

  try {
    const slots = suggestSlots(db, {
      days: 10,
      count: 3,
      durationMinutes: input.durationMinutes ?? 30,
      workspaceOwnerId: input.workspaceOwnerId ?? null,
    });

    if (slots.length === 0) {
      return { requested: false, reason: "no_slots", requestId: null, slots: [] };
    }

    const request: CalendarMeetingRequest = createMeetingRequest(db, {
      thread_id: input.threadId,
      decision_id: input.decisionId,
      target_id: input.targetId,
      duration_minutes: input.durationMinutes ?? 30,
      proposed_slots: slots,
      notes: input.notes ?? null,
      workspace_owner_id: input.workspaceOwnerId,
    });
    return { requested: true, reason: "created", requestId: request.id, slots };
  } catch (error) {
    // A scheduling proposal must never break the SDR decision pipeline.
    console.error("[calendar] meeting request failed:", error);
    return { requested: false, reason: "error", requestId: null, slots: [] };
  }
}
