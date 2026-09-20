/**
 * Habilita la instalacion SDR usando la misma logica que
 * pages/api/inbox/toggle-autopilot.ts (no SQL crudo suelto): activa el switch de
 * cuenta, el de target y crea el mapeo agente<->cuenta que resolveCaptureOwnership
 * necesita para resolver el agente por cuenta.
 *
 * No toca outbound_enabled: el modo es `approval`, ningun envio ocurre sin
 * aprobacion humana.
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

import { getDb } from "../lib/db";
import { ensureSdrAgent } from "../lib/sdr-agent/seed";

const db = getDb();
const WS = "b10f2f76-6b5d-4f30-a965-a6dd69d402b2";
const TARGET = "4b21c3e2-4c48-46b4-8aea-c94061246093";

const { agent } = ensureSdrAgent(db, WS);
console.log("agente:", agent.id, "| version activa:", agent.active_version_id);

db.transaction(() => {
  // 1. Switch por cuenta LinkedIn (accounts.sdr_enabled)
  const accts = db.prepare("UPDATE accounts SET sdr_enabled = 1 WHERE owner_id = ?").run(WS);
  console.log("accounts.sdr_enabled = 1 ->", accts.changes, "fila(s)");

  // 2. Switch por cuenta de email (email_accounts.sdr_enabled), si existe alguna
  const emails = db.prepare("UPDATE email_accounts SET sdr_enabled = 1 WHERE owner_id = ?").run(WS);
  console.log("email_accounts.sdr_enabled = 1 ->", emails.changes, "fila(s)");

  // 3. Mapeo agente<->cuenta (hoy vacio). enabled=1, inbound=1, outbound=0.
  for (const a of db.prepare("SELECT id FROM accounts WHERE owner_id = ?").all(WS) as Array<{ id: string }>) {
    db.prepare(`
      INSERT INTO sdr_agent_accounts(agent_id, account_id, enabled, inbound_enabled, outbound_enabled)
      VALUES (?, ?, 1, 1, 0)
      ON CONFLICT(agent_id, account_id) DO UPDATE SET enabled = 1, inbound_enabled = 1
    `).run(agent.id, a.id);
    console.log("sdr_agent_accounts <-", a.id);
  }

  // 4. Autopilot del target canario
  const t = db.prepare("UPDATE targets SET sdr_autopilot = 1 WHERE id = ?").run(TARGET);
  console.log("targets.sdr_autopilot = 1 ->", t.changes, "fila(s)");

  // 5. El thread canario tambien debe quedar automatizado
  const th = db.prepare(`
    UPDATE sdr_threads SET automation_enabled = 1,
      agent_id = COALESCE(agent_id, ?), agent_version_id = COALESCE(agent_version_id, ?),
      updated_at = datetime('now')
    WHERE target_id = ?
  `).run(agent.id, agent.active_version_id, TARGET);
  console.log("sdr_threads.automation_enabled = 1 ->", th.changes, "fila(s)");
})();

console.log("\n--- estado final ---");
console.log("accounts:", JSON.stringify(db.prepare("SELECT id, sdr_enabled FROM accounts").all()));
console.log("target:", JSON.stringify(db.prepare("SELECT id, sdr_autopilot FROM targets WHERE id = ?").get(TARGET)));
console.log("agent_accounts:", JSON.stringify(db.prepare("SELECT agent_id, account_id, enabled, inbound_enabled, outbound_enabled FROM sdr_agent_accounts").all()));
console.log("threads:", JSON.stringify(db.prepare("SELECT id, state, automation_enabled FROM sdr_threads").all()));
