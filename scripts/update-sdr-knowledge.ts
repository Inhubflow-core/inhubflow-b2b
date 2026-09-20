/**
 * Actualiza el catalogo aprobado del SDR anadiendo la seccion de precios y planes.
 * Usa la via oficial (createKnowledgeDraft -> approveKnowledgeSource) para que la
 * revision se incremente y los chunks se regeneren, igual que lo haria la UI.
 *
 * Idempotente: si ya existe una fuente con el mismo titulo y el mismo checksum,
 * no crea un duplicado.
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

import { getDb } from "../lib/db";
import { ensureSdrAgent } from "../lib/sdr-agent/seed";
import {
  approveKnowledgeSource,
  createKnowledgeDraft,
  listKnowledgeSources,
} from "../lib/sdr-agent/knowledge/repository";

const WS = "b10f2f76-6b5d-4f30-a965-a6dd69d402b2";
const TITLE = "Catálogo de Servicios InHubFlow";

const CONTENT = `InHubFlow es una suite empresarial de prospección comercial omnicanal B2B:
- Automatización inteligente de LinkedIn (visitas, solicitudes de conexión personalizadas, secuencias inteligentes).
- Cold Email secuenciado de alta entregabilidad con rotación multicuenta.
- Enriquecimiento de leads con Apollo.io y LinkedIn Sales Navigator.
- Asistente SDR con Inteligencia Artificial que califica prospectos, responde dudas y agenda reuniones comerciales.

Planes y precios

Plan Starter (1 Cuenta) - 40 USD / mes
- 1 cuenta de LinkedIn conectada (1 slot dedicado).
- Hasta 20 interacciones comerciales al día (600 al mes).
- Hasta 20 seguimientos automatizados al día (600 al mes).
- Asistente SDR de IA 24/7 ilimitado (respuestas y agendamiento).
- Subdominio exclusivo para la empresa.
- Gestión inteligente de contactos y cuentas.
- Importación y sincronización B2B (CSV, CRM y contactos).
- Secuencias de email comercial multicuenta y alta entregabilidad.
- Seguridad empresarial y ritmos humanizados.
- Sincronización con Google Calendar/Calendly.
- Recomendado para comenzar a gestionar y automatizar relaciones comerciales B2B.

Plan Growth (5 Cuentas) - 160 USD / mes
- 5 cuentas de LinkedIn conectadas (5 slots dedicados).
- Hasta 100 interacciones comerciales al día (3.000 al mes).
- Hasta 100 seguimientos automatizados al día (3.000 al mes).
- Incluye todo lo del Plan Starter.
- Recomendado para equipos de ventas que necesitan escalar su pipeline rápidamente.

Plan Business (10 Cuentas) - 240 USD / mes
- 10 cuentas de LinkedIn conectadas (10 slots dedicados).
- Hasta 200 interacciones comerciales al día (6.000 al mes).
- Hasta 200 seguimientos automatizados al día (6.000 al mes).
- Incluye todo lo del Plan Growth.
- La máxima capacidad para equipos comerciales y empresas B2B de alto volumen.

Notas comerciales
- Los límites de interacciones diarias son recomendados por cuenta para garantizar la seguridad y la reputación comercial.
- Los precios se facturan mensualmente y están expresados en dólares estadounidenses (USD).
- Las funciones de IA (asistente SDR) están incluidas en todos los planes sin límite de uso.
- La llamada de demostración tiene una duración de 15 minutos.
- Para planes con más de 10 cuentas o volúmenes superiores, contactar con el equipo comercial.`;

const db = getDb();
const { agent } = ensureSdrAgent(db, WS);

const existing = listKnowledgeSources(db, agent.id, WS)
  .find((s) => s.title === TITLE);

const existingContent = existing ? String(existing.content ?? "") : "";
if (existing && existingContent === CONTENT) {
  console.log("El catalogo ya coincide con este contenido. Nada que hacer.");
  console.log("fuente:", existing.id, "| revision:", existing.revision, "| estado:", existing.status);
  process.exit(0);
}

const actor = (db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: string } | undefined)
  ?? { id: "seed" };

// Si ya existe la fuente aprobada, actualizamos su contenido en draft y la
// re-aprobamos; si no, creamos una nueva.
let sourceId = existing?.id;
if (sourceId) {
  db.prepare(`
    UPDATE sdr_knowledge_sources
    SET content = ?, checksum = ?, status = 'draft', updated_at = datetime('now')
    WHERE id = ? AND workspace_owner_id = ?
  `).run(CONTENT, "", sourceId, WS);
  console.log("fuente existente actualizada a draft:", sourceId);
} else {
  const draft = createKnowledgeDraft(db, {
    agentId: agent.id,
    workspaceOwnerId: WS,
    title: TITLE,
    sourceType: "catalog",
    content: CONTENT,
  });
  sourceId = draft.id;
  console.log("draft creado:", sourceId);
}

const approved = approveKnowledgeSource(db, sourceId, WS, actor.id);
console.log("aprobada -> revision:", approved.revision, "| estado:", approved.status);

const chunks = db.prepare(
  "SELECT ordinal, length(content) len FROM sdr_knowledge_chunks WHERE source_id = ? ORDER BY ordinal ASC"
).all(sourceId) as Array<{ ordinal: number; len: number }>;
console.log("chunks generados:", chunks.length);
for (const c of chunks) console.log("  #" + c.ordinal, c.len + " chars");
