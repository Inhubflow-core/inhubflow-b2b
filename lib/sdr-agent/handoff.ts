import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { recordSdrAuditEvent } from "@/lib/audit";
import { createAppNotification } from "@/lib/notifications/service";

export interface HandoffAssignee {
  userId: string;
  email: string | null;
  source: "account_assignee" | "workspace_owner" | "workspace_admin";
}

interface ThreadAssignmentRow {
  id: string;
  workspace_owner_id: string | null;
  channel: "linkedin" | "email";
  linkedin_account_id: string | null;
  email_account_id: string | null;
  target_id: string;
  external_thread_id: string;
  state: string;
  control_epoch: number;
  target_name: string | null;
  linkedin_assigned_user_id: string | null;
  linkedin_owner_id: string | null;
  email_owner_id: string | null;
  agent_workspace_owner_id: string | null;
}

function loadThreadAssignment(db: Database.Database, threadId: string): ThreadAssignmentRow {
  const row = db.prepare(`
    SELECT th.id, th.workspace_owner_id, th.channel, th.linkedin_account_id,
      th.email_account_id, th.target_id, th.external_thread_id, th.state,
      th.control_epoch, t.full_name AS target_name,
      a.assigned_user_id AS linkedin_assigned_user_id,
      a.owner_id AS linkedin_owner_id,
      ea.owner_id AS email_owner_id,
      ag.workspace_owner_id AS agent_workspace_owner_id
    FROM sdr_threads th
    JOIN targets t ON t.id = th.target_id
    LEFT JOIN accounts a ON a.id = th.linkedin_account_id
    LEFT JOIN email_accounts ea ON ea.id = th.email_account_id
    LEFT JOIN sdr_agents ag ON ag.id = th.agent_id
    WHERE th.id = ?
  `).get(threadId) as ThreadAssignmentRow | undefined;
  if (!row) throw new Error("SDR thread not found");
  return row;
}

function workspaceOf(row: ThreadAssignmentRow): string {
  const workspaceOwnerId =
    row.workspace_owner_id ??
    row.linkedin_owner_id ??
    row.email_owner_id ??
    row.agent_workspace_owner_id;
  if (!workspaceOwnerId) throw new Error("SDR thread is not assigned to a workspace");
  return workspaceOwnerId;
}

function validWorkspaceUser(
  db: Database.Database,
  userId: string,
  workspaceOwnerId: string,
): { id: string; email: string | null } | null {
  const row = db.prepare(`
    SELECT id, email FROM users
    WHERE id = ? AND (id = ? OR owner_id = ?)
  `).get(userId, workspaceOwnerId, workspaceOwnerId) as
    | { id: string; email: string | null }
    | undefined;
  return row ?? null;
}

export function resolveHandoffAssignee(
  db: Database.Database,
  threadId: string,
): HandoffAssignee {
  const thread = loadThreadAssignment(db, threadId);
  const workspaceOwnerId = workspaceOf(thread);

  if (thread.linkedin_assigned_user_id) {
    const assigned = validWorkspaceUser(db, thread.linkedin_assigned_user_id, workspaceOwnerId);
    if (assigned) return { userId: assigned.id, email: assigned.email, source: "account_assignee" };
  }

  const owner = validWorkspaceUser(db, workspaceOwnerId, workspaceOwnerId);
  if (owner) return { userId: owner.id, email: owner.email, source: "workspace_owner" };

  const admin = db.prepare(`
    SELECT id, email FROM users
    WHERE owner_id = ? AND role = 'admin'
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `).get(workspaceOwnerId) as { id: string; email: string | null } | undefined;
  if (admin) return { userId: admin.id, email: admin.email, source: "workspace_admin" };

  throw new Error("No authorized human is available for this SDR handoff");
}

export interface CreateHandoffInput {
  threadId: string;
  messageId: string;
  decisionId?: string | null;
  reasonCodes: string[];
  summary: string;
  recommendedReply?: string | null;
  priority?: "normal" | "urgent" | "critical";
}

export interface CreatedHandoff {
  handoffId: string;
  notificationId: string;
  assignedUserId: string;
  controlEpoch: number;
  duplicate: boolean;
}

export function createHumanHandoff(
  db: Database.Database,
  input: CreateHandoffInput,
): CreatedHandoff {
  return db.transaction(() => {
    const thread = loadThreadAssignment(db, input.threadId);
    const workspaceOwnerId = workspaceOf(thread);
    const assignee = resolveHandoffAssignee(db, input.threadId);
    const primaryReason = input.reasonCodes[0] || "human_review_required";
    const idempotencyKey = `handoff:${input.threadId}:${input.messageId}:${primaryReason}`;
    const existing = db.prepare(`
      SELECT id, assigned_user_id, control_epoch
      FROM sdr_handoffs WHERE idempotency_key = ?
    `).get(idempotencyKey) as
      | { id: string; assigned_user_id: string | null; control_epoch: number }
      | undefined;

    const handoffId = existing?.id ?? randomUUID();
    let controlEpoch = existing?.control_epoch ?? thread.control_epoch;
    if (!existing) {
      const transition = db.prepare(`
        UPDATE sdr_threads
        SET state = 'HUMAN_REVIEW', control_epoch = control_epoch + 1,
          lock_reason = ?, workspace_owner_id = COALESCE(workspace_owner_id, ?),
          updated_at = datetime('now')
        WHERE id = ? AND state NOT IN ('DO_NOT_CONTACT', 'RESOLVED', 'HUMAN_ACTIVE')
      `).run(primaryReason, workspaceOwnerId, input.threadId);
      const current = db.prepare(
        "SELECT state, control_epoch FROM sdr_threads WHERE id = ?",
      ).get(input.threadId) as { state: string; control_epoch: number };
      if (transition.changes !== 1 && current.state !== "HUMAN_REVIEW") {
        throw new Error(`Cannot create handoff for thread in state ${current.state}`);
      }
      controlEpoch = current.control_epoch;

      db.prepare(`
        INSERT INTO sdr_handoffs (
          id, workspace_owner_id, thread_id, message_id, decision_id, state,
          reason_code, summary, recommended_reply, assigned_user_id,
          assigned_email, priority, assignment_source, control_epoch,
          idempotency_key
        ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        handoffId,
        workspaceOwnerId,
        input.threadId,
        input.messageId,
        input.decisionId ?? null,
        primaryReason,
        input.summary.slice(0, 2_000),
        input.recommendedReply ?? null,
        assignee.userId,
        assignee.email,
        input.priority ?? "urgent",
        assignee.source,
        controlEpoch,
        idempotencyKey,
      );

      db.prepare(`
        UPDATE sdr_jobs SET state = 'cancelled', updated_at = datetime('now')
        WHERE thread_id = ? AND state IN ('queued', 'waiting')
      `).run(input.threadId);
      db.prepare(`
        UPDATE sdr_actions
        SET state = 'cancelled', rejection_reason = ?, updated_at = datetime('now')
        WHERE thread_id = ? AND state IN ('proposed', 'waiting_approval', 'approved')
      `).run(primaryReason, input.threadId);
    }

    const targetName = thread.target_name || "Lead";
    const href = `/inbox?thread=${encodeURIComponent(input.threadId)}&message=${encodeURIComponent(input.messageId)}`;
    const notification = createAppNotification(db, {
      workspaceOwnerId,
      userId: existing?.assigned_user_id ?? assignee.userId,
      notificationType: "sdr_handoff",
      priority: input.priority ?? "urgent",
      title: "Asistente SDR: intervención requerida",
      body: `${targetName}: ${input.summary.slice(0, 180)}`,
      href,
      entityType: "sdr_handoff",
      entityId: handoffId,
      threadId: input.threadId,
      handoffId,
      messageId: input.messageId,
      data: {
        reasonCodes: input.reasonCodes,
        targetId: thread.target_id,
        channel: thread.channel,
        accountId: thread.linkedin_account_id,
        emailAccountId: thread.email_account_id,
        externalThreadId: thread.external_thread_id,
      },
      idempotencyKey: `notification:${idempotencyKey}`,
      queueWebPush: true,
    });

    db.prepare(`
      INSERT INTO sdr_notifications (
        id, workspace_owner_id, thread_id, handoff_id, user_id, channel,
        title, body, state, idempotency_key, app_notification_id
      ) VALUES (?, ?, ?, ?, ?, 'in_app', ?, ?, 'sent', ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET app_notification_id = excluded.app_notification_id
    `).run(
      randomUUID(),
      workspaceOwnerId,
      input.threadId,
      handoffId,
      existing?.assigned_user_id ?? assignee.userId,
      notification.title,
      notification.body,
      `legacy:${idempotencyKey}`,
      notification.id,
    );

    recordSdrAuditEvent(db, {
      workspaceOwnerId,
      actorType: "worker",
      entityType: "handoff",
      entityId: handoffId,
      eventType: existing ? "handoff_reused" : "handoff_created",
      threadId: input.threadId,
      handoffId,
      correlationId: input.messageId,
      idempotencyKey: `audit:${idempotencyKey}`,
      payload: { reasons: input.reasonCodes, assignedUserId: assignee.userId, controlEpoch },
    });

    return {
      handoffId,
      notificationId: notification.id,
      assignedUserId: existing?.assigned_user_id ?? assignee.userId,
      controlEpoch,
      duplicate: Boolean(existing),
    };
  })();
}

export interface ControlTransitionInput {
  threadId: string;
  actorUserId: string;
  workspaceOwnerId: string;
  allowAdministrativeOverride?: boolean;
}

export function takeHumanControl(
  db: Database.Database,
  input: ControlTransitionInput,
): { state: "HUMAN_ACTIVE"; controlEpoch: number } {
  return db.transaction(() => {
    const thread = loadThreadAssignment(db, input.threadId);
    if (workspaceOf(thread) !== input.workspaceOwnerId) throw new Error("SDR thread not found");
    const currentOwner = db.prepare(
      "SELECT human_takeover_by_user_id FROM sdr_threads WHERE id = ?",
    ).get(input.threadId) as { human_takeover_by_user_id: string | null };
    if (
      thread.state === "HUMAN_ACTIVE" &&
      currentOwner.human_takeover_by_user_id &&
      currentOwner.human_takeover_by_user_id !== input.actorUserId &&
      !input.allowAdministrativeOverride
    ) {
      throw new Error("This conversation is already controlled by another user");
    }
    if (!["AI_ACTIVE", "WAITING_LEAD", "HUMAN_REVIEW", "HUMAN_ACTIVE"].includes(thread.state)) {
      throw new Error(`Cannot take control of a thread in state ${thread.state}`);
    }

    if (thread.state !== "HUMAN_ACTIVE" || currentOwner.human_takeover_by_user_id !== input.actorUserId) {
      db.prepare(`
        UPDATE sdr_threads
        SET state = 'HUMAN_ACTIVE', control_epoch = control_epoch + 1,
          human_takeover_at = COALESCE(human_takeover_at, datetime('now')),
          human_takeover_by_user_id = ?, lock_reason = 'human_takeover',
          ai_turn_count = 0,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(input.actorUserId, input.threadId);
    }
    db.prepare(`
      UPDATE sdr_handoffs
      SET state = 'acknowledged', assigned_user_id = ?,
        acknowledged_at = COALESCE(acknowledged_at, datetime('now')),
        updated_at = datetime('now')
      WHERE thread_id = ? AND state IN ('open', 'acknowledged')
    `).run(input.actorUserId, input.threadId);
    db.prepare(`
      UPDATE app_notifications
      SET state = 'read', read_at = COALESCE(read_at, datetime('now')),
        updated_at = datetime('now')
      WHERE thread_id = ? AND user_id = ? AND state = 'unread'
    `).run(input.threadId, input.actorUserId);
    db.prepare(`
      UPDATE sdr_jobs SET state = 'cancelled', updated_at = datetime('now')
      WHERE thread_id = ? AND state IN ('queued', 'waiting')
    `).run(input.threadId);
    db.prepare(`
      UPDATE sdr_actions
      SET state = 'cancelled', rejection_reason = 'human_takeover', updated_at = datetime('now')
      WHERE thread_id = ? AND state IN ('proposed', 'waiting_approval', 'approved')
    `).run(input.threadId);

    const updated = db.prepare(
      "SELECT control_epoch FROM sdr_threads WHERE id = ?",
    ).get(input.threadId) as { control_epoch: number };
    recordSdrAuditEvent(db, {
      workspaceOwnerId: input.workspaceOwnerId,
      actorType: "user",
      actorUserId: input.actorUserId,
      entityType: "thread",
      entityId: input.threadId,
      eventType: "human_takeover",
      threadId: input.threadId,
      payload: { controlEpoch: updated.control_epoch },
    });
    return { state: "HUMAN_ACTIVE" as const, controlEpoch: updated.control_epoch };
  })();
}

export function releaseHumanControl(
  db: Database.Database,
  input: ControlTransitionInput & { nextState?: "AI_ACTIVE" | "WAITING_LEAD" },
): { state: "AI_ACTIVE" | "WAITING_LEAD"; controlEpoch: number } {
  return db.transaction(() => {
    const thread = loadThreadAssignment(db, input.threadId);
    if (workspaceOf(thread) !== input.workspaceOwnerId) throw new Error("SDR thread not found");
    const nextState = input.nextState ?? "AI_ACTIVE";
    if (thread.state === nextState || (thread.state === "AI_ACTIVE" && nextState === "AI_ACTIVE")) {
      // Idempotent release: thread is already active for AI, clear any lingering handoffs or locks
      db.prepare(`
        UPDATE sdr_threads
        SET human_takeover_at = NULL, human_takeover_by_user_id = NULL,
          lock_reason = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(input.threadId);
      db.prepare(`
        UPDATE sdr_handoffs
        SET state = 'resolved', resolved_at = COALESCE(resolved_at, datetime('now')),
          released_at = datetime('now'), released_by_user_id = ?, updated_at = datetime('now')
        WHERE thread_id = ? AND state IN ('open', 'acknowledged')
      `).run(input.actorUserId, input.threadId);
      const updated = db.prepare(
        "SELECT control_epoch FROM sdr_threads WHERE id = ?",
      ).get(input.threadId) as { control_epoch: number };
      return { state: nextState, controlEpoch: updated?.control_epoch ?? 0 };
    }
    if (!["HUMAN_REVIEW", "HUMAN_ACTIVE", "WAITING_LEAD"].includes(thread.state)) {
      throw new Error(`Cannot release a thread in state ${thread.state}`);
    }
    db.prepare(`
      UPDATE sdr_threads
      SET state = ?, control_epoch = control_epoch + 1,
        human_released_at = datetime('now'), human_released_by_user_id = ?,
        human_takeover_at = NULL, human_takeover_by_user_id = NULL,
        ai_turn_count = 0,
        lock_reason = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(nextState, input.actorUserId, input.threadId);
    db.prepare(`
      UPDATE sdr_handoffs
      SET state = 'resolved', resolved_at = COALESCE(resolved_at, datetime('now')),
        released_at = datetime('now'), released_by_user_id = ?, updated_at = datetime('now')
      WHERE thread_id = ? AND state IN ('open', 'acknowledged')
    `).run(input.actorUserId, input.threadId);
    const updated = db.prepare(
      "SELECT control_epoch FROM sdr_threads WHERE id = ?",
    ).get(input.threadId) as { control_epoch: number };
    recordSdrAuditEvent(db, {
      workspaceOwnerId: input.workspaceOwnerId,
      actorType: "user",
      actorUserId: input.actorUserId,
      entityType: "thread",
      entityId: input.threadId,
      eventType: "human_control_released",
      threadId: input.threadId,
      payload: { nextState, controlEpoch: updated.control_epoch },
    });
    return { state: nextState, controlEpoch: updated.control_epoch };
  })();
}

export function markThreadDoNotContact(
  db: Database.Database,
  input: { threadId: string; messageId: string; reason: string },
): void {
  db.transaction(() => {
    const thread = loadThreadAssignment(db, input.threadId);
    const workspaceOwnerId = workspaceOf(thread);
    db.prepare(`
      UPDATE sdr_threads
      SET state = 'DO_NOT_CONTACT', control_epoch = control_epoch + 1,
        lock_reason = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(input.reason, input.threadId);
    db.prepare(`
      UPDATE sdr_jobs SET state = 'cancelled', updated_at = datetime('now')
      WHERE thread_id = ? AND state IN ('queued', 'waiting')
    `).run(input.threadId);
    db.prepare(`
      UPDATE sdr_actions
      SET state = 'cancelled', rejection_reason = ?, updated_at = datetime('now')
      WHERE thread_id = ? AND state IN ('proposed', 'waiting_approval', 'approved')
    `).run(input.reason, input.threadId);

    // Stop campaign outreach immediately for this target
    if (thread.target_id) {
      try {
        db.prepare(`
          UPDATE targets SET do_not_contact = 1, updated_at = datetime('now')
          WHERE id = ?
        `).run(thread.target_id);
        db.prepare(`
          UPDATE run_profile_tracks
          SET state = 'cancelled', reason = ?, updated_at = datetime('now')
          WHERE target_id = ? AND state IN ('pending', 'running', 'queued')
        `).run(`sdr_dnc:${input.reason}`, thread.target_id);
      } catch {
        // Safe execution if run_profile_tracks table is absent
      }
    }

    recordSdrAuditEvent(db, {
      workspaceOwnerId,
      actorType: "worker",
      entityType: "thread",
      entityId: input.threadId,
      eventType: "do_not_contact",
      threadId: input.threadId,
      correlationId: input.messageId,
      idempotencyKey: `audit:dnc:${input.threadId}:${input.messageId}`,
      payload: { reason: input.reason },
    });
  })();
}
