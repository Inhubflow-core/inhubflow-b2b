import { getDb } from "@/lib/db";
import { createHash, randomUUID } from "crypto";
import { unipile, UnipileClient } from "@/lib/unipile/client";
import { sendEmail } from "@/lib/email/sender";
import type { EmailAccount } from "@/lib/email/sender";
import {
  createLinkedInConnectionAttempt,
  countLinkedInConnectionAttemptsToday,
  updateLinkedInConnectionAttempt,
} from "@/lib/linkedin/connection-attempts";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import {
  ensureLinkedInTargetAccountState,
  markLinkedInTargetState,
} from "@/lib/linkedin/account-state";
import {
  getLinkedInStepDelivery,
  prepareLinkedInStepDelivery,
  updateLinkedInStepDelivery,
} from "@/lib/linkedin/step-deliveries";
import { linkedInDayBounds, nextAllowedLinkedInTime } from "@/lib/linkedin/schedule";
import { releaseRuntimeLease, tryAcquireRuntimeLease } from "@/lib/runtime-lease";
import type {
  UnipileAccount,
  UnipileProfile,
  UnipileSendInvitationResponse,
  UnipileSendMessageResponse,
  UnipileStartChatResponse,
} from "@/lib/unipile/types";

interface TrackRun {
  id: string;
  run_profile_id: string;
  track: "linkedin" | "email";
  state: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  current_step: number;
  last_step_at: string | null;
  next_step_at: string | null;
  error_message: string | null;
  force_run_once: number;
}

interface WorkflowStep {
  id: string;
  workflow_id: string;
  track: "linkedin" | "email";
  step_order: number;
  step_type: "visit" | "connect" | "message" | "email" | "delay";
  template_id?: string | null;
  delay_seconds: number;
  connect_note?: string | null;
  message_body?: string | null;
  email_subject?: string | null;
  email_body?: string | null;
  enabled: number;
}

interface Target {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name: string | null;
  title?: string | null;
  headline?: string | null;
  company?: string | null;
  location?: string | null;
  profile_image_url?: string | null;
  linkedin_member_urn?: string | null;
  linkedin_url: string | null;
  unipile_provider_id: string | null;
  unipile_chat_id: string | null;
  messaging_urn: string | null;
  email: string | null;
  degree: number | null;
  connection_requested_at: string | null;
  connected_at: string | null;
  message_sent_at: string | null;
  last_replied_account_id?: string | null;
}

export interface RunnerUnipileClient {
  isConfigured(): boolean;
  listAccounts(): Promise<{ items: UnipileAccount[] }>;
  resolveProfile(identifier: string, accountId: string): Promise<UnipileProfile>;
  sendInvitation(params: { account_id: string; provider_id: string; message?: string }): Promise<UnipileSendInvitationResponse>;
  startChat(params: { account_id: string; attendees_ids: string[]; text: string }): Promise<UnipileStartChatResponse>;
  sendMessage(params: { chat_id: string; text: string }): Promise<UnipileSendMessageResponse>;
}

export interface RunnerDependencies {
  client?: RunnerUnipileClient;
  now?: () => number;
  resolveAccount?: (db: ReturnType<typeof getDb>, localAccountId: string, client: RunnerUnipileClient) => Promise<{ unipileAccountId: string }>;
}

function nowIso(now = Date.now()): string { return new Date(now).toISOString(); }
function addHours(hours: number, now = Date.now()): string { return new Date(now + hours * 3600 * 1000).toISOString(); }

function log(db: ReturnType<typeof getDb>, runId: string, targetId: string | null, level: "info" | "warn" | "error", message: string) {
  const rendered = `[campaign-runner] [${level.toUpperCase()}] run=${runId} target=${targetId || "-"} ${message}`;
  if (level === "error") console.error(rendered);
  else if (level === "warn") console.warn(rendered);
  else console.log(rendered);
  try {
    db.prepare(`
      INSERT INTO logs (id, run_id, target_id, level, message, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(randomUUID(), runId, targetId, level, `[${level.toUpperCase()}] ${message}`);
  } catch { /* logging must not stop a campaign */ }
}

function trAdvance(db: ReturnType<typeof getDb>, tr: TrackRun, steps: WorkflowStep[]) {
  const nextIndex = tr.current_step + 1;
  if (nextIndex >= steps.length) {
    db.prepare(`UPDATE run_profile_tracks SET state = 'completed', current_step = ?, last_step_at = datetime('now'), next_step_at = NULL, error_message = NULL WHERE id = ?`).run(nextIndex, tr.id);
    return;
  }
  const next = steps[nextIndex];
  const nextAt = next.delay_seconds > 0 ? addHours(next.delay_seconds / 3600) : null;
  db.prepare(`UPDATE run_profile_tracks SET current_step = ?, last_step_at = datetime('now'), next_step_at = ?, error_message = NULL WHERE id = ?`).run(nextIndex, nextAt, tr.id);
}

function trWait(db: ReturnType<typeof getDb>, tr: TrackRun, hours = 6, now = Date.now()) {
  db.prepare(`UPDATE run_profile_tracks SET state = 'in_progress', error_message = NULL, next_step_at = ? WHERE id = ?`).run(addHours(hours, now), tr.id);
}

function trDefer(db: ReturnType<typeof getDb>, tr: TrackRun, reason: string, hours = 1, now = Date.now()) {
  db.prepare(`UPDATE run_profile_tracks SET state = 'in_progress', error_message = ?, next_step_at = ? WHERE id = ?`)
    .run(reason, addHours(hours, now), tr.id);
}

function trFail(db: ReturnType<typeof getDb>, tr: TrackRun, reason: string) {
  db.prepare(`UPDATE run_profile_tracks SET state = 'failed', error_message = ?, next_step_at = NULL WHERE id = ?`).run(reason, tr.id);
}

function targetName(target: Target): string { return target.full_name || target.linkedin_url || "Contacto"; }

function isConnected(target: Target): boolean { return Boolean(target.connected_at) || target.degree === 1; }

function profileIsConnected(profile: UnipileProfile): boolean {
  return profile.network_distance === "FIRST_DEGREE" || profile.is_relationship === true || Boolean(profile.connected_at);
}

function profileHasPendingInvitation(profile: UnipileProfile): boolean {
  return profile.invitation?.type === "SENT" && profile.invitation?.status === "PENDING";
}

function enrichTarget(db: ReturnType<typeof getDb>, accountId: string, target: Target, profile: UnipileProfile) {
  const firstName = profile.first_name || null;
  const lastName = profile.last_name || null;
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;
  const currentRole = (profile.work_experience || []).find((role) => role.current === true)
    || (profile.work_experience || []).find((role) => role.end == null);
  const values = {
    firstName: target.first_name || firstName,
    lastName: target.last_name || lastName,
    fullName: target.full_name || fullName,
    title: target.title || target.headline || profile.headline || currentRole?.position || null,
    company: target.company || currentRole?.company || null,
    location: target.location || profile.location || null,
    image: target.profile_image_url || profile.profile_picture_url || profile.picture_url || null,
    memberUrn: target.linkedin_member_urn || profile.member_urn || null,
  };
  db.prepare(`
    UPDATE targets SET
      unipile_provider_id = ?,
      first_name = COALESCE(first_name, ?),
      last_name = COALESCE(last_name, ?),
      full_name = COALESCE(full_name, ?),
      title = COALESCE(title, ?),
      company = COALESCE(company, ?),
      location = COALESCE(location, ?),
      profile_image_url = COALESCE(profile_image_url, ?),
      linkedin_member_urn = COALESCE(linkedin_member_urn, ?),
      degree = CASE WHEN ? THEN 1 ELSE degree END,
      connected_at = CASE WHEN ? THEN COALESCE(connected_at, datetime('now')) ELSE connected_at END
    WHERE id = ?
  `).run(
    profile.provider_id,
    values.firstName,
    values.lastName,
    values.fullName,
    values.title,
    values.company,
    values.location,
    values.image,
    values.memberUrn,
    profileIsConnected(profile) ? 1 : 0,
    profileIsConnected(profile) ? 1 : 0,
    target.id,
  );
  const connected = profileIsConnected(profile);
  markLinkedInTargetState(db, accountId, target.id, {
    unipile_provider_id: profile.provider_id,
    ...(connected ? { degree: 1, connected_at: new Date().toISOString() } : {}),
  });
}

function renderTemplate(body: string, target: Target): string {
  return body
    .replace(/\{\{first_name\}\}/gi, target.first_name || target.full_name?.split(/\s+/)[0] || "")
    .replace(/\{\{last_name\}\}/gi, target.last_name || target.full_name?.split(/\s+/).slice(1).join(" ") || "")
    .replace(/\{\{full_name\}\}/gi, target.full_name || "")
    .replace(/\{\{company\}\}/gi, target.company || "")
    .replace(/\{\{title\}\}/gi, target.title || target.headline || "")
    .replace(/\{\{location\}\}/gi, target.location || "")
    .trim();
}

function stepText(db: ReturnType<typeof getDb>, step: WorkflowStep, target: Target, kind: "connect" | "message"): string {
  let body = kind === "connect" ? step.connect_note || "" : step.message_body || "";
  if (!body && step.template_id) {
    const template = db.prepare("SELECT body FROM templates WHERE id = ?").get(step.template_id) as { body?: string } | undefined;
    body = template?.body || "";
  }
  if (!body && kind === "message") {
    const templates = db.prepare(`
      SELECT t.body
      FROM workflow_step_templates wst
      JOIN templates t ON t.id = wst.template_id
      WHERE wst.step_id = ?
      ORDER BY t.id
    `).all(step.id) as Array<{ body: string }>;
    if (templates.length > 0) {
      const hash = createHash("sha256").update(`${step.id}:${target.id}`, "utf8").digest();
      body = templates[hash.readUInt32BE(0) % templates.length].body;
    }
  }
  return renderTemplate(body, target);
}

function providerErrorStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: number }).status) : undefined;
}

function providerErrorBody(error: unknown): string {
  if (typeof error === "object" && error !== null && "body" in error) {
    return String((error as { body?: string }).body || "").toLowerCase();
  }
  return error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
}

function recordOutboundMessage(db: ReturnType<typeof getDb>, runId: string, workflowId: string, target: Target, chatId: string, messageId: string, text: string) {
  db.prepare(`
    INSERT INTO linkedin_inbox_messages (
      id, account_id, target_id, run_id, workflow_id, external_thread_id,
      external_message_id, direction, sender_external_id, sender_name, body,
      sent_at, identity_mode, metadata_json
    )
    SELECT ?, r.account_id, ?, ?, ?, ?, ?, 'outbound', '', 'Me', ?, datetime('now'), 'profile_url', ?
    FROM runs r WHERE r.id = ?
    ON CONFLICT(account_id, external_thread_id, external_message_id) DO NOTHING
  `).run(randomUUID(), target.id, runId, workflowId, chatId, messageId, text, JSON.stringify({ source: "campaign-runner-unipile" }), runId);
}

async function resolveRemoteAccount(db: ReturnType<typeof getDb>, localAccountId: string, client: RunnerUnipileClient, deps: RunnerDependencies) {
  if (deps.resolveAccount) return deps.resolveAccount(db, localAccountId, client);
  return resolveUnipileAccount(db, localAccountId, client as UnipileClient);
}

export async function processSingleTrack(db: ReturnType<typeof getDb>, tr: TrackRun, deps: RunnerDependencies = {}): Promise<void> {
  const client = deps.client || unipile;
  const now = deps.now || Date.now;
  const runProfile = db.prepare(`
    SELECT rp.id, rp.run_id, rp.target_id, r.workflow_id, r.account_id, r.email_account_id
    FROM run_profiles rp JOIN runs r ON r.id = rp.run_id WHERE rp.id = ?
  `).get(tr.run_profile_id) as { id: string; run_id: string; target_id: string; workflow_id: string; account_id: string; email_account_id?: string | null } | undefined;
  if (!runProfile) { trFail(db, tr, "Run profile not found"); return; }

  const steps = db.prepare(`SELECT * FROM workflow_steps WHERE workflow_id = ? AND track = ? AND enabled = 1 ORDER BY step_order ASC`).all(runProfile.workflow_id, tr.track) as WorkflowStep[];
  if (steps.length === 0 || tr.current_step >= steps.length) {
    db.prepare("UPDATE run_profile_tracks SET state = 'completed', next_step_at = NULL WHERE id = ?").run(tr.id);
    return;
  }
  const step = steps[tr.current_step];
  const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(runProfile.target_id) as Target | undefined;
  if (!target) { trFail(db, tr, "Target not found"); return; }
  const scopedState = ensureLinkedInTargetAccountState(db, runProfile.account_id, target);
  target.unipile_provider_id = scopedState.unipile_provider_id;
  target.unipile_chat_id = scopedState.unipile_chat_id;
  target.degree = scopedState.degree;
  target.connection_requested_at = scopedState.connection_requested_at;
  target.connected_at = scopedState.connected_at;
  target.message_sent_at = scopedState.message_sent_at;
  const name = targetName(target);

  if (step.step_type === "email") {
    if (!target.email) { log(db, runProfile.run_id, target.id, "warn", `${name} no tiene email`); trFail(db, tr, "No email address found"); return; }
    if (!runProfile.email_account_id) { trFail(db, tr, "No email account configured"); return; }
    const emailAccount = db.prepare("SELECT * FROM email_accounts WHERE id = ?").get(runProfile.email_account_id) as EmailAccount | undefined;
    if (!emailAccount) { trFail(db, tr, "Email account not found"); return; }
    try {
      await sendEmail(emailAccount, target.email, step.email_subject || "Hola", step.email_body || "");
      log(db, runProfile.run_id, target.id, "info", `Email enviado a ${target.email}`);
      trAdvance(db, tr, steps);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(db, runProfile.run_id, target.id, "error", `Error enviando email: ${message}`);
      trFail(db, tr, message);
    }
    return;
  }
  if (step.step_type === "delay") {
    const nextIndex = tr.current_step + 1;
    if (nextIndex >= steps.length) {
      trAdvance(db, tr, steps);
      return;
    }
    const delaySeconds = Math.max(0, Number(step.delay_seconds || 0));
    if (delaySeconds > 0 && !tr.next_step_at) {
      db.prepare(`
        UPDATE run_profile_tracks
        SET state = 'in_progress', last_step_at = datetime('now'), next_step_at = ?
        WHERE id = ?
      `).run(new Date(now() + delaySeconds * 1000).toISOString(), tr.id);
      return;
    }
    trAdvance(db, tr, steps);
    return;
  }

  if (!client.isConfigured()) {
    const message = "Unipile no está configurado; el paso no se ejecutó";
    log(db, runProfile.run_id, target.id, "error", message);
    trDefer(db, tr, message, 1, now());
    return;
  }

  if (tr.force_run_once !== 1) {
    const schedule = db.prepare(`
      SELECT timezone, working_days, active_hours_start, active_hours_end
      FROM accounts WHERE id = ?
    `).get(runProfile.account_id) as {
      timezone?: string | null;
      working_days?: string | null;
      active_hours_start?: number | null;
      active_hours_end?: number | null;
    } | undefined;
    const window = nextAllowedLinkedInTime({
      timezone: schedule?.timezone || "UTC",
      workingDays: schedule?.working_days || "1,2,3,4,5",
      activeHoursStart: schedule?.active_hours_start ?? 9,
      activeHoursEnd: schedule?.active_hours_end ?? 18,
    }, now());
    if (!window.allowed && window.nextAt) {
      db.prepare("UPDATE run_profile_tracks SET state = 'in_progress', next_step_at = ?, error_message = NULL WHERE id = ?")
        .run(window.nextAt, tr.id);
      return;
    }
  }

  let remoteAccount: { unipileAccountId: string };
  try {
    remoteAccount = await resolveRemoteAccount(db, runProfile.account_id, client, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(db, runProfile.run_id, target.id, "error", `Cuenta Unipile no disponible: ${message}`);
    trDefer(db, tr, message, 1, now());
    return;
  }
  const accountId = remoteAccount.unipileAccountId;

  let providerId = target.unipile_provider_id;
  const resolveProfile = async (): Promise<UnipileProfile> => {
    if (!target.linkedin_url) throw new Error("El prospecto no tiene URL de LinkedIn");
    const profile = await client.resolveProfile(target.linkedin_url, accountId);
    if (!profile?.provider_id) throw new Error("Unipile no devolvió provider_id");
    providerId = profile.provider_id;
    return profile;
  };

  if (step.step_type === "visit") {
    try {
      const profile = await resolveProfile();
      enrichTarget(db, runProfile.account_id, target, profile);
      log(db, runProfile.run_id, target.id, "info", `Perfil visitado/sincronizado vía Unipile para ${name}`);
      trAdvance(db, tr, steps);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(db, runProfile.run_id, target.id, "error", `No se pudo sincronizar el perfil: ${message}`);
      if (message.includes("no tiene URL")) trFail(db, tr, message);
      else trDefer(db, tr, message, 1, now());
    }
    return;
  }

  if (step.step_type === "connect") {
    if (isConnected(target)) { log(db, runProfile.run_id, target.id, "info", `${name} ya está conectado; continuando la secuencia`); trAdvance(db, tr, steps); return; }

    const priorDelivery = getLinkedInStepDelivery(db, tr.id, step.id);

    // Reconcile legacy/local pending state against Unipile before deciding to wait.
    // Older browser executors could stamp connection_requested_at without actually
    // submitting an invitation, so the remote profile is the source of truth.
    if (target.connection_requested_at) {
      try {
        const profile = await resolveProfile();
        enrichTarget(db, runProfile.account_id, target, profile);
        if (profileIsConnected(profile)) {
          trAdvance(db, tr, steps);
          return;
        }
        if (profileHasPendingInvitation(profile)) {
          log(db, runProfile.run_id, target.id, "info", `La invitación a ${name} está pendiente en LinkedIn; esperando aceptación`);
          trWait(db, tr, 6, now());
          return;
        }
        if (priorDelivery?.state === "confirmed" || priorDelivery?.state === "uncertain" || priorDelivery?.state === "prepared") {
          trWait(db, tr, 6, now());
          return;
        }

        markLinkedInTargetState(db, runProfile.account_id, target.id, {
          connection_requested_at: null,
          unipile_provider_id: profile.provider_id,
        });
        target.connection_requested_at = null;
        log(db, runProfile.run_id, target.id, "warn", `Se eliminó un marcador local obsoleto para ${name}: Unipile confirma que no hay invitación pendiente`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(db, runProfile.run_id, target.id, "warn", `No se pudo reconciliar la invitación pendiente de ${name}: ${message}`);
        trWait(db, tr, 1, now());
        return;
      }
    }

    if (priorDelivery?.state === "prepared") {
      updateLinkedInStepDelivery(db, priorDelivery.id, "uncertain", {
        errorMessage: "Ejecución interrumpida antes de confirmar la respuesta de Unipile",
      });
    }
    if (priorDelivery?.state === "confirmed" || priorDelivery?.state === "uncertain" || priorDelivery?.state === "prepared") {
      if (!target.connection_requested_at) {
        markLinkedInTargetState(db, runProfile.account_id, target.id, {
          connection_requested_at: nowIso(now()),
          ...(providerId ? { unipile_provider_id: providerId } : {}),
        });
      }
      trWait(db, tr, 6, now());
      return;
    }

    let attemptId = "";
    let deliveryId = "";
    try {
      if (target.linkedin_url) {
        const profile = await resolveProfile();
        enrichTarget(db, runProfile.account_id, target, profile);
        if (profileIsConnected(profile)) {
          log(db, runProfile.run_id, target.id, "info", `${name} ya está conectado según Unipile; continuando la secuencia`);
          trAdvance(db, tr, steps);
          return;
        }
        if (profileHasPendingInvitation(profile)) {
          markLinkedInTargetState(db, runProfile.account_id, target.id, {
            connection_requested_at: nowIso(now()),
            unipile_provider_id: profile.provider_id,
          });
          log(db, runProfile.run_id, target.id, "info", `La invitación a ${name} ya está pendiente; esperando aceptación`);
          trWait(db, tr, 6, now());
          return;
        }
      }
      if (!providerId) providerId = (await resolveProfile()).provider_id;
      const account = db.prepare("SELECT daily_connection_limit, timezone FROM accounts WHERE id = ?").get(runProfile.account_id) as { daily_connection_limit?: number; timezone?: string | null } | undefined;
      const limit = Math.max(1, Number(account?.daily_connection_limit || 20));
      const dayBounds = linkedInDayBounds(account?.timezone || "UTC", now());
      const note = stepText(db, step, target, "connect").slice(0, 300);
      db.transaction(() => {
        if (countLinkedInConnectionAttemptsToday(db, runProfile.account_id, dayBounds) >= limit) throw new Error("Límite diario de conexiones alcanzado");
        const reservation = prepareLinkedInStepDelivery(db, {
          trackId: tr.id,
          stepId: step.id,
          runId: runProfile.run_id,
          targetId: target.id,
          accountId: runProfile.account_id,
          actionType: "connect",
          payload: JSON.stringify({ providerId, note }),
        });
        if (!reservation.acquired) throw new Error(`La entrega ya está reservada (${reservation.delivery.state})`);
        deliveryId = reservation.delivery.id;
        attemptId = createLinkedInConnectionAttempt(db, { accountId: runProfile.account_id, runId: runProfile.run_id, targetId: target.id, attemptedAt: nowIso(now()) });
      })();

      const response = await client.sendInvitation({ account_id: accountId, provider_id: providerId, message: note || undefined });
      if (response?.status === "failed" || !response?.invitation_id) {
        updateLinkedInConnectionAttempt(db, attemptId, "rejected", "Unipile no confirmó la invitación");
        updateLinkedInStepDelivery(db, deliveryId, "failed", { errorMessage: "Unipile no confirmó la invitación" });
        trFail(db, tr, "Unipile no confirmó la invitación");
        return;
      }
      updateLinkedInConnectionAttempt(db, attemptId, "submitted");
      updateLinkedInStepDelivery(db, deliveryId, "confirmed", { externalId: response.invitation_id });
      markLinkedInTargetState(db, runProfile.account_id, target.id, {
        connection_requested_at: nowIso(now()),
        unipile_provider_id: providerId,
      });
      log(db, runProfile.run_id, target.id, "info", `Solicitud de conexión enviada a ${name} vía Unipile`);
      trWait(db, tr, 6, now());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const providerBody = providerErrorBody(error);
      if (message.includes("Límite diario")) { log(db, runProfile.run_id, target.id, "warn", message); trWait(db, tr, 24, now()); return; }
      if (message.includes("ya está reservada")) { trDefer(db, tr, message, 0.05, now()); return; }
      if (attemptId && providerBody.includes("already_connected")) {
        updateLinkedInConnectionAttempt(db, attemptId, "confirmed");
        if (deliveryId) updateLinkedInStepDelivery(db, deliveryId, "confirmed", { externalId: "already-connected" });
        markLinkedInTargetState(db, runProfile.account_id, target.id, {
          ...(providerId ? { unipile_provider_id: providerId } : {}),
          degree: 1,
          connected_at: nowIso(now()),
        });
        log(db, runProfile.run_id, target.id, "info", `${name} ya estaba conectado; continuando la secuencia`);
        trAdvance(db, tr, steps);
        return;
      }
      const invitationAlreadyPending = [
        "action_already_performed",
        "cannot_resend_yet",
        "cannot_resend_within_24hrs",
        "already_invited_recently",
      ].some((code) => providerBody.includes(code));
      if (attemptId && invitationAlreadyPending) {
        updateLinkedInConnectionAttempt(db, attemptId, "submitted");
        if (deliveryId) updateLinkedInStepDelivery(db, deliveryId, "confirmed", { externalId: "existing-pending-invitation" });
        markLinkedInTargetState(db, runProfile.account_id, target.id, {
          connection_requested_at: nowIso(now()),
          ...(providerId ? { unipile_provider_id: providerId } : {}),
        });
        log(db, runProfile.run_id, target.id, "info", `La invitación a ${name} ya estaba pendiente; esperando aceptación`);
        trWait(db, tr, 6, now());
        return;
      }
      const providerLimit = providerBody.includes("limit_exceeded") || providerBody.includes("connection_limit_reached") || providerErrorStatus(error) === 429;
      if (attemptId && providerLimit) {
        updateLinkedInConnectionAttempt(db, attemptId, "rejected", message);
        if (deliveryId) updateLinkedInStepDelivery(db, deliveryId, "failed", { errorMessage: message });
        log(db, runProfile.run_id, target.id, "warn", `Unipile/LinkedIn informó un límite temporal: ${message}`);
        trWait(db, tr, 24, now());
        return;
      }
      if (attemptId) {
        const status = providerErrorStatus(error);
        if (status) {
          updateLinkedInConnectionAttempt(db, attemptId, "rejected", message);
          if (deliveryId) updateLinkedInStepDelivery(db, deliveryId, "failed", { errorMessage: message });
        } else {
          updateLinkedInConnectionAttempt(db, attemptId, "uncertain", message);
          if (deliveryId) updateLinkedInStepDelivery(db, deliveryId, "uncertain", { errorMessage: message });
          markLinkedInTargetState(db, runProfile.account_id, target.id, {
            connection_requested_at: nowIso(now()),
            ...(providerId ? { unipile_provider_id: providerId } : {}),
          });
          log(db, runProfile.run_id, target.id, "warn", `Resultado incierto al enviar invitación; no se reintentará automáticamente: ${message}`);
          trWait(db, tr, 6, now());
          return;
        }
      }
      log(db, runProfile.run_id, target.id, "error", `Error enviando invitación: ${message}`);
      trFail(db, tr, message);
    }
    return;
  }

  if (step.step_type === "message") {
    const priorDelivery = getLinkedInStepDelivery(db, tr.id, step.id);
    if (priorDelivery?.state === "confirmed") {
      markLinkedInTargetState(db, runProfile.account_id, target.id, {
        message_sent_at: target.message_sent_at || nowIso(now()),
        ...(priorDelivery.external_thread_id ? { unipile_chat_id: priorDelivery.external_thread_id } : {}),
      });
      trAdvance(db, tr, steps);
      return;
    }
    if (priorDelivery?.state === "prepared") {
      updateLinkedInStepDelivery(db, priorDelivery.id, "uncertain", {
        errorMessage: "Ejecución interrumpida antes de confirmar la respuesta de Unipile",
      });
    }
    if (priorDelivery?.state === "uncertain" || priorDelivery?.state === "prepared") {
      const message = "El resultado del envío anterior es incierto; se bloqueó el reintento para evitar duplicados";
      log(db, runProfile.run_id, target.id, "warn", message);
      trFail(db, tr, message);
      return;
    }
    if (!isConnected(target)) {
      try {
        const profile = await resolveProfile();
        enrichTarget(db, runProfile.account_id, target, profile);
        if (!profileIsConnected(profile)) {
          trWait(db, tr, 6, now());
          return;
        }
        target.degree = 1;
        target.connected_at = nowIso(now());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("no tiene URL")) trFail(db, tr, message);
        else trDefer(db, tr, message, 1, now());
        return;
      }
    }
    const messageLimit = db.prepare("SELECT daily_message_limit, timezone FROM accounts WHERE id = ?").get(runProfile.account_id) as { daily_message_limit?: number; timezone?: string | null } | undefined;
    const messageDayBounds = linkedInDayBounds(messageLimit?.timezone || "UTC", now());
    const messagesToday = db.prepare(`
      SELECT COUNT(*) AS count FROM linkedin_inbox_messages
      WHERE account_id = ? AND direction = 'outbound'
        AND datetime(sent_at) >= datetime(?) AND datetime(sent_at) < datetime(?)
    `).get(runProfile.account_id, messageDayBounds.start, messageDayBounds.end) as { count: number };
    if (messagesToday.count >= Math.max(1, Number(messageLimit?.daily_message_limit || 20))) {
      log(db, runProfile.run_id, target.id, "warn", "Límite diario de mensajes alcanzado");
      trWait(db, tr, 24, now());
      return;
    }

    let deliveryId = "";
    try {
      if (!target.unipile_chat_id && !providerId) providerId = (await resolveProfile()).provider_id;
      const text = stepText(db, step, target, "message") || "Hola!";
      const reservation = prepareLinkedInStepDelivery(db, {
        trackId: tr.id,
        stepId: step.id,
        runId: runProfile.run_id,
        targetId: target.id,
        accountId: runProfile.account_id,
        actionType: "message",
        payload: JSON.stringify({ chatId: target.unipile_chat_id, providerId, text }),
      });
      if (!reservation.acquired) throw new Error(`La entrega ya está reservada (${reservation.delivery.state})`);
      deliveryId = reservation.delivery.id;

      let chatId = target.unipile_chat_id;
      let messageId: string | null = null;
      if (chatId) {
        try {
          const sent = await client.sendMessage({ chat_id: chatId, text });
          messageId = sent?.message_id || null;
        } catch (error) {
          const body = providerErrorBody(error);
          const staleChat = providerErrorStatus(error) === 404
            || body.includes("resource_not_found")
            || body.includes("invalid_resource_identifier");
          if (!staleChat) throw error;
          if (!providerId) providerId = (await resolveProfile()).provider_id;
          markLinkedInTargetState(db, runProfile.account_id, target.id, { unipile_chat_id: null });
          const started = await client.startChat({ account_id: accountId, attendees_ids: [providerId], text });
          chatId = started?.chat_id || null;
          messageId = started?.message_id || null;
        }
      } else if (providerId) {
        const started = await client.startChat({ account_id: accountId, attendees_ids: [providerId], text });
        chatId = started?.chat_id || null;
        messageId = started?.message_id || null;
      }
      if (!chatId || !messageId) throw new Error("Unipile no confirmó chat_id y message_id del mensaje");

      db.transaction(() => {
        updateLinkedInStepDelivery(db, deliveryId, "confirmed", {
          externalId: messageId,
          externalThreadId: chatId,
        });
        markLinkedInTargetState(db, runProfile.account_id, target.id, {
          unipile_chat_id: chatId,
          message_sent_at: nowIso(now()),
          ...(providerId ? { unipile_provider_id: providerId } : {}),
        });
        recordOutboundMessage(db, runProfile.run_id, runProfile.workflow_id, target, chatId, messageId, text);
        trAdvance(db, tr, steps);
      })();
      log(db, runProfile.run_id, target.id, "info", `Mensaje enviado a ${name} vía Unipile`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ya está reservada")) {
        trDefer(db, tr, message, 0.05, now());
        return;
      }
      if (deliveryId) {
        const state = providerErrorStatus(error) ? "failed" : "uncertain";
        updateLinkedInStepDelivery(db, deliveryId, state, { errorMessage: message });
      }
      log(db, runProfile.run_id, target.id, "error", `Error enviando mensaje: ${message}`);
      trFail(db, tr, message);
    }
    return;
  }

  trAdvance(db, tr, steps);
}

function refreshRunCompletion(db: ReturnType<typeof getDb>, runProfileId: string): void {
  const run = db.prepare("SELECT run_id FROM run_profiles WHERE id = ?").get(runProfileId) as { run_id: string } | undefined;
  if (!run) return;
  const counts = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN rt.state IN ('completed', 'failed', 'skipped') THEN 1 ELSE 0 END) AS terminal,
      SUM(CASE WHEN rt.state = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN rt.state = 'skipped' THEN 1 ELSE 0 END) AS skipped
    FROM run_profile_tracks rt
    JOIN run_profiles rp ON rp.id = rt.run_profile_id
    WHERE rp.run_id = ?
  `).get(run.run_id) as { total: number; terminal: number; completed: number; skipped: number };
  if (counts.total === 0 || counts.terminal !== counts.total) return;
  const status = counts.completed > 0 || counts.skipped > 0 ? "completed" : "failed";
  db.prepare(`
    UPDATE runs SET status = ?, completed_at = COALESCE(completed_at, datetime('now'))
    WHERE id = ? AND status = 'running'
  `).run(status, run.run_id);
}

let isTicking = false;
let globalRunnerTimer: NodeJS.Timeout | null = null;

export async function enqueueTick(customDb?: ReturnType<typeof getDb>): Promise<void> {
  if (isTicking) return;
  isTicking = true;
  const db = customDb || getDb();
  const leaseKey = "linkedin-campaign-runner";
  const leaseOwner = tryAcquireRuntimeLease(db, leaseKey, 120_000);
  if (!leaseOwner) { isTicking = false; return; }
  try {
    const pendingTracks = db.prepare(`
      SELECT rt.* FROM run_profile_tracks rt
      JOIN run_profiles rp ON rp.id = rt.run_profile_id
      JOIN runs r ON r.id = rp.run_id
      WHERE r.status = 'running' AND (
        rt.force_run_once = 1 OR (rt.state IN ('pending', 'in_progress') AND (rt.next_step_at IS NULL OR rt.next_step_at <= datetime('now')))
      ) ORDER BY rt.force_run_once DESC, rt.next_step_at ASC LIMIT 10
    `).all() as TrackRun[];
    for (const tr of pendingTracks) {
      if (tr.force_run_once === 1) db.prepare("UPDATE run_profile_tracks SET force_run_once = 0 WHERE id = ?").run(tr.id);
      await processSingleTrack(db, tr);
      refreshRunCompletion(db, tr.run_profile_id);
    }
  } catch (error) { console.error("[campaign-runner] Error en enqueueTick:", error); }
  finally {
    releaseRuntimeLease(db, leaseKey, leaseOwner);
    isTicking = false;
  }
}

export function ensureGlobalRunnerStarted(): void {
  if (globalRunnerTimer) return;
  console.log("[campaign-runner] Iniciando bucle de ejecución de campañas (Unipile Engine)...");
  globalRunnerTimer = setInterval(() => { enqueueTick().catch((error) => console.error("[campaign-runner] Error en timer tick:", error)); }, 30_000);
}

export function startRun(runId: string): void {
  const db = getDb();
  db.prepare("UPDATE runs SET status = 'running', started_at = COALESCE(started_at, datetime('now')) WHERE id = ?").run(runId);
  enqueueTick(db).catch((error) => console.error("[campaign-runner] Error iniciando run:", error));
}

export async function forceRunStep(runId: string, targetId?: string): Promise<{ success: boolean; message: string }> {
  const db = getDb();
  const predicate = targetId ? "AND rp.target_id = ?" : "";
  const params = targetId ? [runId, targetId] : [runId];
  db.prepare(`UPDATE run_profile_tracks SET state = 'in_progress', next_step_at = datetime('now'), force_run_once = 1, error_message = NULL WHERE run_profile_id IN (SELECT rp.id FROM run_profiles rp WHERE rp.run_id = ? ${predicate}) AND state NOT IN ('completed')`).run(...params);
  db.prepare("UPDATE runs SET status = 'running', started_at = COALESCE(started_at, datetime('now')) WHERE id = ?").run(runId);
  enqueueTick(db).catch((error) => console.error("[campaign-runner] Error en forceRunStep:", error));
  return { success: true, message: "Paso de campaña ejecutado vía Unipile" };
}
