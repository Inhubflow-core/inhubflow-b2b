import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createSdrBridge } from "@/lib/sdr-agent/bridge";
import { attachTargetToList, enrollSignalTarget, upsertCampaignTarget } from "@/lib/campaigns/enrollment";
import type { SignalLead, SignalMonitor } from "./schema";

export interface SignalPromotionReadiness {
  ready: boolean;
  blockers: string[];
  sdrReady: boolean;
}

export function signalAutopilotReadiness(
  db: Database.Database,
  monitor: SignalMonitor,
): SignalPromotionReadiness {
  const blockers: string[] = [];
  if (!monitor.account_id) blockers.push("linkedin_account_required");
  if (!monitor.target_list_id) blockers.push("target_list_required");
  if (!monitor.target_workflow_id) blockers.push("target_workflow_required");
  if (monitor.account_id) {
    const account = db.prepare("SELECT is_authenticated FROM accounts WHERE id = ?").get(monitor.account_id) as { is_authenticated: number } | undefined;
    if (!account || account.is_authenticated !== 1) blockers.push("linkedin_account_not_ready");
  }
  if (monitor.target_list_id && !db.prepare("SELECT 1 FROM lists WHERE id = ?").get(monitor.target_list_id)) blockers.push("target_list_not_found");
  if (monitor.target_workflow_id) {
    const workflow = db.prepare("SELECT 1 FROM workflows WHERE id = ? AND COALESCE(is_archived, 0) = 0").get(monitor.target_workflow_id);
    if (!workflow) blockers.push("target_workflow_not_found");
    const messageStep = db.prepare(`
      SELECT 1 FROM workflow_steps
      WHERE workflow_id = ? AND track = 'linkedin' AND step_type = 'message' AND enabled = 1
      LIMIT 1
    `).get(monitor.target_workflow_id);
    if (!messageStep) blockers.push("linkedin_message_step_required");
  }
  const sdrStatus = monitor.workspace_owner_id
    ? createSdrBridge({ getDatabase: () => db }).getStatus(monitor.workspace_owner_id)
    : null;
  const sdrReady = Boolean(sdrStatus?.linkedinOutboundEnabled && sdrStatus.providerEnabled);
  if (!sdrReady) blockers.push(...(sdrStatus?.blockers || ["sdr_not_ready"]));
  return { ready: blockers.length === 0, blockers: [...new Set(blockers)], sdrReady };
}

function logPromotionEvent(db: Database.Database, monitorId: string, eventType: string, details: Record<string, unknown>): void {
  db.prepare(`
    INSERT INTO signal_events (id, monitor_id, event_type, details_json, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(randomUUID(), monitorId, eventType, JSON.stringify(details));
}

export function promoteSignalLead(
  db: Database.Database,
  leadId: string,
  input: { trigger: "manual" | "autopilot"; listId?: string | null; workflowId?: string | null },
): { state: string; targetId: string | null; runId: string | null; blockers?: string[] } {
  const lead = db.prepare("SELECT * FROM signal_leads WHERE id = ?").get(leadId) as SignalLead | undefined;
  if (!lead) throw new Error("Lead de señal no encontrado");
  const monitor = db.prepare("SELECT * FROM signal_monitors WHERE id = ?").get(lead.monitor_id) as SignalMonitor | undefined;
  if (!monitor) throw new Error("Monitor de señal no encontrado");
  const listId = input.listId || monitor.target_list_id;
  const workflowId = input.workflowId || monitor.target_workflow_id;
  if (!listId) throw new Error("Selecciona una lista de destino");

  if (input.trigger === "autopilot") {
    const readiness = signalAutopilotReadiness(db, monitor);
    if (!readiness.ready) {
      db.prepare(`
        UPDATE signal_leads SET promotion_state = 'blocked', promotion_error = ?, status = 'pending', updated_at = datetime('now')
        WHERE id = ?
      `).run(readiness.blockers.join(","), lead.id);
      logPromotionEvent(db, monitor.id, "autopilot_blocked", { leadId: lead.id, blockers: readiness.blockers });
      return { state: "blocked", targetId: null, runId: null, blockers: readiness.blockers };
    }
  }

  const existingPromotion = db.prepare(`
    SELECT * FROM signal_promotions
    WHERE lead_id = ? AND workflow_id IS ?
    ORDER BY created_at DESC LIMIT 1
  `).get(lead.id, workflowId || null) as { id: string; state: string; target_id: string | null; run_id: string | null } | undefined;
  if (existingPromotion && ["imported", "enrolled"].includes(existingPromotion.state)) {
    return { state: existingPromotion.state, targetId: existingPromotion.target_id, runId: existingPromotion.run_id };
  }

  const promotionId = existingPromotion?.id || randomUUID();
  if (!existingPromotion) {
    db.prepare(`
      INSERT INTO signal_promotions (id, lead_id, list_id, workflow_id, state)
      VALUES (?, ?, ?, ?, 'promoting')
    `).run(promotionId, lead.id, listId, workflowId || null);
  } else {
    db.prepare("UPDATE signal_promotions SET state = 'promoting', error_message = NULL, updated_at = datetime('now') WHERE id = ?").run(promotionId);
  }
  db.prepare("UPDATE signal_leads SET promotion_state = 'promoting', promotion_error = NULL, updated_at = datetime('now') WHERE id = ?").run(lead.id);

  try {
    const promoted = db.transaction((): {
      targetId: string;
      enrollment: ReturnType<typeof enrollSignalTarget> | null;
    } => {
      const id = upsertCampaignTarget(db, {
        linkedinUrl: lead.linkedin_url,
        fullName: lead.full_name,
        headline: lead.headline,
        company: lead.company,
        location: lead.location,
        providerId: lead.provider_id,
        profileImageUrl: lead.profile_image_url || null,
      });
      attachTargetToList(db, listId, id);
      if (input.trigger === "autopilot") {
        db.prepare("UPDATE targets SET sdr_autopilot = 1 WHERE id = ?").run(id);
      }
      let enrollment: ReturnType<typeof enrollSignalTarget> | null = null;
      if (workflowId) {
        if (!monitor.account_id) throw new Error("El monitor no tiene una cuenta de LinkedIn asignada");
        enrollment = enrollSignalTarget(db, {
          targetId: id,
          listId,
          workflowId,
          accountId: monitor.account_id,
          messageBody: lead.icebreaker_preview,
          messageMetadata: {
            source: "signal_radar",
            signalLeadId: lead.id,
            monitorId: monitor.id,
            generation: lead.message_metadata_json ? JSON.parse(lead.message_metadata_json) : null,
          },
        });
      }
      return { targetId: id, enrollment };
    })();
    const { targetId, enrollment } = promoted;
    const state = workflowId && enrollment?.enrolled ? "enrolled" : workflowId && enrollment?.reason ? "blocked" : "imported";
    const error = enrollment?.reason || null;
    db.transaction(() => {
      db.prepare(`
        UPDATE signal_promotions SET target_id = ?, run_id = ?, run_profile_id = ?, state = ?, error_message = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(targetId, enrollment?.runId || null, enrollment?.runProfileId || null, state, error, promotionId);
      db.prepare(`
        UPDATE signal_leads SET imported_target_id = ?, status = ?, promotion_state = ?, promotion_error = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(targetId, state === "enrolled" ? "enrolled" : "imported", state, error, lead.id);
    })();
    logPromotionEvent(db, monitor.id, state === "enrolled" ? "lead_enrolled" : "lead_imported", {
      leadId: lead.id,
      targetId,
      runId: enrollment?.runId || null,
      trigger: input.trigger,
      state,
      reason: error,
    });
    return { state, targetId, runId: enrollment?.runId || null, ...(error ? { blockers: [error] } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.transaction(() => {
      db.prepare("UPDATE signal_promotions SET state = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?")
        .run(message, promotionId);
      db.prepare("UPDATE signal_leads SET promotion_state = 'failed', promotion_error = ?, status = 'failed', updated_at = datetime('now') WHERE id = ?")
        .run(message, lead.id);
    })();
    logPromotionEvent(db, monitor.id, "lead_promotion_failed", { leadId: lead.id, error: message });
    throw error;
  }
}
