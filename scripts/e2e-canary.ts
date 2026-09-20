/**
 * E2E canary: publica un inbound real por la via del repositorio SDR y ejecuta
 * un tick del worker con Gemini real. No hace envios outbound.
 *
 * Falla con salida != 0 si:
 *  - el inbound no encola job (instalacion deshabilitada: sdr_enabled / sdr_autopilot)
 *  - el job no se completa
 *  - el knowledge aprobado deja de estar conectado (missing_approved_knowledge)
 *
 * Uso: npx tsx scripts/e2e-canary.ts
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
// Carga manual de .env.local (Next lo hace solo en runtime; tsx no).
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
import { getDb } from "../lib/db";
import { captureSdrInboundMessage } from "../lib/sdr-agent/repository";
import { runSdrWorkerTick } from "../lib/sdr-agent/worker";
import { releaseHumanControl } from "../lib/sdr-agent/handoff";

const THREAD = "c5d2f33e-08ab-464c-9715-4ab3ed50a1ad";
const TARGET = "4b21c3e2-4c48-46b4-8aea-c94061246093";
const WS = "b10f2f76-6b5d-4f30-a965-a6dd69d402b2";

const body =
  "Hola! Gracias por contactar. Me interesa saber mas sobre InHubFlow, " +
  "especialmente como funciona la automatizacion de LinkedIn y cuanto cuesta. " +
  "Podeis enviarme informacion por escrito?";

const failures: string[] = [];

async function main() {
  const db = getDb();
  const account = db.prepare("SELECT id FROM accounts LIMIT 1").get() as { id: string };
  const extThread = db.prepare(
    "SELECT external_thread_id FROM sdr_threads WHERE id = ?"
  ).get(THREAD) as { external_thread_id: string | null };

  const externalThreadId = extThread.external_thread_id || "e2e-canary-thread-1";
  const externalMessageId = `e2e-canary-${randomUUID()}`;

  const event = {
    eventId: `e2e-evt-${randomUUID()}`,
    channel: "linkedin" as const,
    targetId: TARGET,
    accountId: account.id,
    externalThreadId,
    externalMessageId,
    senderName: "More Fernández",
    body,
    receivedAt: new Date().toISOString(),
  };

  // El canary anterior deja el thread en HUMAN_REVIEW (handoff correcto). Lo liberamos
  // por la via oficial para que la prueba sea repetible sin intervencion manual.
  const actor = (db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: string } | undefined)
    ?? { id: "canary" };
  try {
    releaseHumanControl(db, { threadId: THREAD, actorUserId: actor.id, workspaceOwnerId: WS });
  } catch {
    // El thread ya estaba en AI_ACTIVE: el release es idempotente, seguimos.
  }

  console.log("--- 1. captura inbound ---");
  const captured = captureSdrInboundMessage(db, event);
  console.log("thread state :", captured.thread.state, "| auto:", captured.thread.automation_enabled);
  console.log("message id   :", captured.message.id);
  console.log("duplicate    :", captured.duplicate);
  console.log("job          :", captured.job ? captured.job.id + " (" + captured.job.state + ")" : "NINGUNO");

  if (!captured.job) {
    failures.push(
      "No se encolo ningun job. Revisa accounts.sdr_enabled y targets.sdr_autopilot " +
      "(ejecuta scripts/enable-sdr-install.ts).",
    );
    report();
    return;
  }

  console.log("\n--- 2. worker tick (Gemini real) ---");
  const tick = await runSdrWorkerTick(db, { maxJobs: 1 });
  console.log(JSON.stringify(tick, null, 2));
  if (tick.processed !== 1 || tick.failed > 0) {
    failures.push(`El tick no proceso el job limpiamente: ${JSON.stringify(tick)}`);
  }

  console.log("\n--- 3. decision generada ---");
  const dec = db.prepare(
    "SELECT * FROM sdr_decisions WHERE thread_id = ? ORDER BY datetime(created_at) DESC LIMIT 1"
  ).get(THREAD) as Record<string, unknown> | undefined;
  if (!dec) {
    failures.push("No se genero ninguna decision.");
  } else {
    console.log("policy_outcome   :", dec.policy_outcome);
    console.log("knowledge_status :", dec.knowledge_status);
    console.log("intent           :", dec.intent, "| confianza:", dec.confidence, "| riesgo:", dec.risk_level);
    console.log("reason_code      :", dec.reason_code);
    console.log("requires_human   :", dec.requires_human);
    console.log("citations        :", String(dec.citations_json ?? ""));
    console.log("missing_info     :", String(dec.missing_information_json ?? ""));
    console.log("reply_draft      :", String(dec.reply_draft ?? "(ninguno)").slice(0, 400));
    console.log("modelo           :", dec.model, "| latencia:", dec.latency_ms + "ms");

    // El guardrail de conocimiento es la señal de que el catalogo aprobado sigue
    // conectado. Si aparece, el SDR ha dejado de estar fundamentado.
    const reasons = String(dec.policy_reasons_json ?? "");
    if (reasons.includes("missing_approved_knowledge") || dec.knowledge_status === "missing") {
      failures.push(
        "El knowledge aprobado no esta conectado: la decision escalo por " +
        "missing_approved_knowledge. Revisa sdr_knowledge_sources (status='approved', " +
        "agent_id correcto) y que existan chunks para su revision.",
      );
    }
  }

  console.log("\n--- 4. acciones SDR ---");
  const acts = db.prepare(
    "SELECT id, action_type, state, payload_json FROM sdr_actions WHERE thread_id = ? ORDER BY datetime(created_at) DESC"
  ).all(THREAD) as Array<Record<string, unknown>>;
  if (!acts.length) console.log("(sin acciones)");
  for (const a of acts) {
    console.log(" ", a.action_type, "->", a.state, "|", String(a.payload_json ?? "").slice(0, 160));
  }

  console.log("\n--- 5. job final ---");
  // El worker puede re-encolar el job con la misma idempotency_key si el proveedor
  // reintenta, asi que basta con que ALGUN job del thread haya completado.
  const job = db.prepare(`
    SELECT id, job_type, state, attempts, last_error FROM sdr_jobs
    WHERE thread_id = ? AND state = 'completed'
    ORDER BY datetime(created_at) DESC LIMIT 1
  `).get(THREAD) as Record<string, unknown> | undefined;
  console.log(JSON.stringify(job, null, 2));
  if (!job) {
    failures.push(
      "Ningun job del thread llego a 'completed'. Ultimo estado: " +
      String((db.prepare("SELECT state, last_error FROM sdr_jobs WHERE thread_id = ? ORDER BY datetime(created_at) DESC LIMIT 1").get(THREAD) as Record<string, unknown> | undefined)?.state) +
      ". Si el error es provider_unavailable, la API de Gemini esta saturada: reintenta.",
    );
  }

  console.log("\n--- 6. uso de tokens ---");
  const usage = db.prepare(
    "SELECT model, provider, status, COUNT(*) n, SUM(input_tokens) tin, SUM(output_tokens) tout, SUM(cost_usd) cost FROM sdr_usage_ledger GROUP BY model, provider, status"
  ).all();
  console.log(JSON.stringify(usage));

  report();
}

function report() {
  if (failures.length === 0) {
    console.log("\nOK: canary E2E correcto.");
    return;
  }
  console.log("\nFALLOS:");
  for (const f of failures) console.log(" - " + f);
  process.exitCode = 1;
}

main().catch((e) => { console.error("FALLO:", e); process.exit(1); });
