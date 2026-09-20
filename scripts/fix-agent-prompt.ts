/**
 * Corrige el system_prompt del agente SDR: pedia ofrecer "una llamada de 15
 * minutos", una cifra que no figuraba en la evidencia aprobada, asi que el
 * guardrail unsupported_numeric_claim bloqueaba TODA respuesta fundamentada.
 *
 * La duracion de la demo pasa a vivir en el catalogo aprobado (unica fuente de
 * evidencia) y el prompt deja de fijarla.
 *
 * Idempotente: no reescribe si ya esta corregido.
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

import { getDb } from "../lib/db";

const db = getDb();
const AGENT = "9cccfcaa-8961-49b8-bf9e-42b3d2aa2518";

const version = db.prepare(
  "SELECT id, version_number, system_prompt FROM sdr_agent_versions WHERE agent_id = ? ORDER BY version_number DESC LIMIT 1"
).get(AGENT) as { id: string; version_number: number; system_prompt: string } | undefined;

if (!version) {
  console.error("No hay version de agente que corregir.");
  process.exit(1);
}

const current = version.system_prompt;
if (!current.includes("15 minutos")) {
  console.log("El prompt ya no fija la duracion de la demo. Nada que hacer.");
  process.exit(0);
}

const next = current.replace(
  "proponer una breve llamada de 15 minutos para una demo",
  "proponer una breve llamada de demo (usa SOLO la duracion que aparezca en el catalogo aprobado)",
);

db.prepare(
  "UPDATE sdr_agent_versions SET system_prompt = ? WHERE id = ?"
).run(next, version.id);

console.log("version corregida:", version.id, "(v" + version.version_number + ")");
console.log("\n--- antes ---");
console.log(current.split("\n").filter((l) => l.includes("15 minutos")).join("\n"));
console.log("--- despues ---");
console.log(next.split("\n").filter((l) => l.includes("duracion")).join("\n"));
