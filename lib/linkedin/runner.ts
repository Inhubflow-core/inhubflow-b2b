import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";
import { unipile } from "@/lib/unipile/client";
import { sendEmail } from "@/lib/email/sender";
import { decryptSecret } from "@/lib/crypto";

// Interfaces básicas para el Runner de Campañas
interface TrackRun {
  id: string;
  run_profile_id: string;
  track: "linkedin" | "email";
  state: "pending" | "in_progress" | "waiting" | "completed" | "failed" | "skipped";
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
  full_name: string | null;
  linkedin_url: string | null;
  unipile_provider_id: string | null;
  unipile_chat_id: string | null;
  messaging_urn: string | null;
  email: string | null;
  degree: number | null;
  connection_requested_at: string | null;
  connected_at: string | null;
  message_sent_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function addHours(hours: number): string {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

function log(
  db: ReturnType<typeof getDb>,
  runId: string,
  targetId: string | null,
  level: "info" | "warn" | "error",
  message: string
) {
  try {
    db.prepare(`
      INSERT INTO logs (id, run_id, target_id, message, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(randomUUID(), runId, targetId, `[${level.toUpperCase()}] ${message}`);
  } catch {
    // ignore
  }
}

// ─── Control de Estados de Pasos ─────────────────────────────────────────────

function trAdvance(db: ReturnType<typeof getDb>, tr: TrackRun, steps: WorkflowStep[]) {
  const nextIndex = tr.current_step + 1;
  if (nextIndex >= steps.length) {
    db.prepare(
      "UPDATE run_profile_tracks SET state = 'completed', current_step = ?, last_step_at = datetime('now'), next_step_at = NULL WHERE id = ?"
    ).run(nextIndex, tr.id);
  } else {
    const nextStep = steps[nextIndex];
    const nextAt = nextStep.delay_seconds > 0 ? new Date(Date.now() + nextStep.delay_seconds * 1000).toISOString() : null;
    db.prepare(
      "UPDATE run_profile_tracks SET current_step = ?, last_step_at = datetime('now'), next_step_at = ? WHERE id = ?"
    ).run(nextIndex, nextAt, tr.id);
  }
}

function trWait(db: ReturnType<typeof getDb>, tr: TrackRun, hours: number) {
  db.prepare("UPDATE run_profile_tracks SET state = 'in_progress', error_message = NULL, next_step_at = ? WHERE id = ?").run(addHours(hours), tr.id);
}

function trSkip(db: ReturnType<typeof getDb>, tr: TrackRun, reason: string) {
  db.prepare("UPDATE run_profile_tracks SET state = 'skipped', error_message = ? WHERE id = ?").run(reason, tr.id);
}

function trFail(db: ReturnType<typeof getDb>, tr: TrackRun, reason: string) {
  db.prepare("UPDATE run_profile_tracks SET state = 'failed', error_message = ? WHERE id = ?").run(reason, tr.id);
}

// ─── Procesador de Pasos de Campaña ──────────────────────────────────────────

async function processSingleTrack(db: ReturnType<typeof getDb>, tr: TrackRun): Promise<void> {
  const runProfile = db.prepare(`
    SELECT rp.id, rp.run_id, rp.target_id, r.workflow_id, r.account_id, r.email_account_id
    FROM run_profiles rp
    JOIN runs r ON r.id = rp.run_id
    WHERE rp.id = ?
  `).get(tr.run_profile_id) as {
    id: string;
    run_id: string;
    target_id: string;
    workflow_id: string;
    account_id: string;
    email_account_id?: string | null;
  } | undefined;

  if (!runProfile) {
    trFail(db, tr, "Run profile not found");
    return;
  }

  const steps = db.prepare(`
    SELECT * FROM workflow_steps
    WHERE workflow_id = ? AND track = ? AND enabled = 1
    ORDER BY step_order ASC
  `).all(runProfile.workflow_id, tr.track) as WorkflowStep[];

  if (steps.length === 0 || tr.current_step >= steps.length) {
    db.prepare("UPDATE run_profile_tracks SET state = 'completed', next_step_at = NULL WHERE id = ?").run(tr.id);
    return;
  }

  const step = steps[tr.current_step];
  const target = db.prepare(`
    SELECT * FROM targets WHERE id = ?
  `).get(runProfile.target_id) as Target | undefined;

  if (!target) {
    trFail(db, tr, "Target not found");
    return;
  }

  const account = db.prepare(`
    SELECT id, name, unipile_account_id, is_authenticated FROM accounts WHERE id = ?
  `).get(runProfile.account_id) as { id: string; name: string; unipile_account_id?: string | null; is_authenticated: number } | undefined;

  const targetName = target.full_name || "Contacto";
  const unipileAccId = account?.unipile_account_id || runProfile.account_id;

  // 1. Paso de EMAIL
  if (step.step_type === "email") {
    if (!target.email) {
      log(db, runProfile.run_id, target.id, "warn", `${targetName} no tiene email. Saltando track de email.`);
      trSkip(db, tr, "No email address found");
      return;
    }

    if (!runProfile.email_account_id) {
      log(db, runProfile.run_id, target.id, "warn", "No hay cuenta de email configurada para este run.");
      trSkip(db, tr, "No email account configured");
      return;
    }

    const emailAccount = db.prepare("SELECT * FROM email_accounts WHERE id = ?").get(runProfile.email_account_id) as any;
    if (!emailAccount) {
      trFail(db, tr, "Email account not found");
      return;
    }

    try {
      const subject = step.email_subject || "Hola";
      const body = step.email_body || "";
      await sendEmail(emailAccount, target.email, subject, body);

      log(db, runProfile.run_id, target.id, "info", `Email enviado a ${target.email}`);
      trAdvance(db, tr, steps);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log(db, runProfile.run_id, target.id, "error", `Error enviando email: ${errorMsg}`);
      trFail(db, tr, errorMsg);
    }
    return;
  }

  // 2. Paso de DELAY
  if (step.step_type === "delay") {
    trAdvance(db, tr, steps);
    return;
  }

  // 3. Pasos de LINKEDIN (vía Unipile API)
  if (!unipile.isConfigured()) {
    log(db, runProfile.run_id, target.id, "warn", "Unipile no configurado (simulación local). Avanzando paso.");
    trAdvance(db, tr, steps);
    return;
  }

  // Resolver provider_id si no lo tiene
  let providerId = target.unipile_provider_id;
  if (!providerId && target.linkedin_url) {
    try {
      const profile = await unipile.resolveProfile(target.linkedin_url, unipileAccId);
      providerId = profile.provider_id;
      if (providerId) {
        db.prepare("UPDATE targets SET unipile_provider_id = ? WHERE id = ?").run(providerId, target.id);
      }
    } catch (err) {
      console.warn(`[runner] No se pudo resolver perfil de LinkedIn en Unipile para ${targetName}:`, err);
    }
  }

  if (step.step_type === "visit") {
    log(db, runProfile.run_id, target.id, "info", `Perfil visitado/sincronizado para ${targetName} vía Unipile`);
    trAdvance(db, tr, steps);
    return;
  }

  if (step.step_type === "connect") {
    if (target.connected_at || target.degree === 1) {
      log(db, runProfile.run_id, target.id, "info", `${targetName} ya está conectado. Avanzando.`);
      trAdvance(db, tr, steps);
      return;
    }

    if (!providerId) {
      trFail(db, tr, "No se pudo obtener el identificador de LinkedIn en Unipile para enviar conexión");
      return;
    }

    try {
      log(db, runProfile.run_id, target.id, "info", `Enviando solicitud de conexión a ${targetName} vía Unipile`);
      await unipile.sendInvitation({
        account_id: unipileAccId,
        provider_id: providerId,
        message: step.connect_note || undefined,
      });

      db.prepare("UPDATE targets SET connection_requested_at = datetime('now') WHERE id = ?").run(target.id);
      trWait(db, tr, 6); // Esperar 6 horas para verificar aceptación
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log(db, runProfile.run_id, target.id, "error", `Error enviando invitación: ${errorMsg}`);
      trFail(db, tr, errorMsg);
    }
    return;
  }

  if (step.step_type === "message") {
    const textToSend = step.message_body || "Hola!";
    try {
      log(db, runProfile.run_id, target.id, "info", `Enviando mensaje a ${targetName} vía Unipile`);

      if (target.unipile_chat_id) {
        await unipile.sendMessage({
          chat_id: target.unipile_chat_id,
          text: textToSend,
        });
      } else if (providerId) {
        const chat = await unipile.startChat({
          account_id: unipileAccId,
          attendees_ids: [providerId],
          text: textToSend,
        });
        if (chat?.id) {
          db.prepare("UPDATE targets SET unipile_chat_id = ? WHERE id = ?").run(chat.id, target.id);
        }
      } else {
        throw new Error("No hay identificador de contacto ni chat disponible para enviar el mensaje");
      }

      db.prepare("UPDATE targets SET message_sent_at = datetime('now') WHERE id = ?").run(target.id);
      trAdvance(db, tr, steps);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log(db, runProfile.run_id, target.id, "error", `Error enviando mensaje: ${errorMsg}`);
      trFail(db, tr, errorMsg);
    }
    return;
  }

  // Si no coincide ningún tipo, avanzar
  trAdvance(db, tr, steps);
}

// ─── Loop Global y API Pública ───────────────────────────────────────────────

let isTicking = false;
let globalRunnerTimer: NodeJS.Timeout | null = null;

export async function enqueueTick(customDb?: ReturnType<typeof getDb>): Promise<void> {
  if (isTicking) return;
  isTicking = true;

  try {
    const db = customDb || getDb();
    const pendingTracks = db.prepare(`
      SELECT rt.*
      FROM run_profile_tracks rt
      JOIN run_profiles rp ON rp.id = rt.run_profile_id
      JOIN runs r ON r.id = rp.run_id
      WHERE r.status = 'running'
        AND (
          rt.force_run_once = 1
          OR (
            rt.state IN ('pending', 'in_progress')
            AND (rt.next_step_at IS NULL OR rt.next_step_at <= datetime('now'))
          )
        )
      ORDER BY rt.force_run_once DESC, rt.next_step_at ASC
      LIMIT 10
    `).all() as TrackRun[];

    for (const tr of pendingTracks) {
      if (tr.force_run_once === 1) {
        db.prepare("UPDATE run_profile_tracks SET force_run_once = 0 WHERE id = ?").run(tr.id);
      }
      await processSingleTrack(db, tr);
    }
  } catch (err) {
    console.error("[campaign-runner] Error en enqueueTick:", err);
  } finally {
    isTicking = false;
  }
}

export function ensureGlobalRunnerStarted(): void {
  if (globalRunnerTimer) return;
  console.log("[campaign-runner] Iniciando bucle de ejecución de campañas (Unipile Engine)...");

  globalRunnerTimer = setInterval(() => {
    enqueueTick().catch((err) => console.error("[campaign-runner] Error en timer tick:", err));
  }, 30_000);
}

export function startRun(runId: string): void {
  const db = getDb();
  db.prepare("UPDATE runs SET status = 'running', started_at = COALESCE(started_at, datetime('now')) WHERE id = ?").run(runId);
  console.log(`[campaign-runner] Campaña ${runId} iniciada`);
  enqueueTick(db).catch((err) => console.error("[campaign-runner] Error iniciando run:", err));
}

export async function forceRunStep(
  runId: string,
  targetId?: string
): Promise<{ success: boolean; message: string }> {
  const db = getDb();

  if (targetId) {
    db.prepare(`
      UPDATE run_profile_tracks SET
        state = 'in_progress',
        next_step_at = datetime('now'),
        force_run_once = 1,
        error_message = NULL
      WHERE run_profile_id IN (
        SELECT id FROM run_profiles WHERE run_id = ? AND target_id = ?
      ) AND state NOT IN ('completed')
    `).run(runId, targetId);
  } else {
    db.prepare(`
      UPDATE run_profile_tracks SET
        state = 'in_progress',
        next_step_at = datetime('now'),
        force_run_once = 1,
        error_message = NULL
      WHERE run_profile_id IN (
        SELECT id FROM run_profiles WHERE run_id = ?
      ) AND state NOT IN ('completed')
    `).run(runId);
  }

  db.prepare("UPDATE runs SET status = 'running', started_at = COALESCE(started_at, datetime('now')) WHERE id = ?").run(runId);
  enqueueTick(db).catch((err) => console.error("[campaign-runner] Error en forceRunStep:", err));

  return { success: true, message: "Paso de campaña ejecutado inmediatamente vía Unipile" };
}
