import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { applySdrSchema } from "./schema";
import { approveKnowledgeSource } from "./knowledge/repository";

export interface SdrAgentRecord {
  id: string;
  workspace_owner_id: string | null;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  mode: "off" | "shadow" | "approval" | "auto";
  default_language: "en" | "es" | "pt-BR";
  model: string | null;
  active_version_id: string | null;
  handoff_email: string | null;
  confidence_threshold: number;
  max_auto_turns: number;
  daily_budget_usd: number | null;
  runtime_enabled: number;
  provider_enabled: number;
  outbound_enabled: number;
  config_revision: number;
}

export interface SdrAgentVersionRecord {
  id: string;
  agent_id: string;
  version_number: number;
  model: string | null;
  system_prompt: string;
  policy_json: string;
  config_json: string;
  knowledge_revision: string | null;
  publication_state: string;
  revision_hash: string | null;
  published_at: string;
}

export interface SdrAgentWithVersion {
  agent: SdrAgentRecord;
  activeVersion: SdrAgentVersionRecord | null;
}

function resolveWorkspaceOwnerId(
  db: Database.Database,
  requested?: string | null,
): string {
  if (requested?.trim()) return requested.trim();
  const owners = db.prepare(
    "SELECT id FROM users WHERE owner_id IS NULL ORDER BY created_at ASC, id ASC LIMIT 2",
  ).all() as Array<{ id: string }>;
  if (owners.length !== 1) {
    throw new Error("A workspace owner id is required to resolve the SDR agent safely");
  }
  return owners[0].id;
}

function revisionHash(input: {
  model: string;
  prompt: string;
  policyJson: string;
  configJson: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input), "utf8")
    .digest("hex");
}

function claimLegacyAgent(
  db: Database.Database,
  workspaceOwnerId: string,
): SdrAgentRecord | null {
  const scopedCount = (db.prepare(
    "SELECT COUNT(*) AS count FROM sdr_agents WHERE workspace_owner_id IS NOT NULL",
  ).get() as { count: number }).count;
  if (scopedCount !== 0) return null;

  const legacy = db.prepare(
    "SELECT * FROM sdr_agents WHERE workspace_owner_id IS NULL ORDER BY created_at ASC LIMIT 2",
  ).all() as SdrAgentRecord[];
  if (legacy.length !== 1) return null;

  db.prepare(`
    UPDATE sdr_agents
    SET workspace_owner_id = ?, mode = 'approval', runtime_enabled = 1,
      provider_enabled = 1, outbound_enabled = 1, status = 'active', updated_at = datetime('now')
    WHERE id = ? AND workspace_owner_id IS NULL
  `).run(workspaceOwnerId, legacy[0].id);
  db.prepare(`
    UPDATE sdr_knowledge_sources
    SET workspace_owner_id = ?,
      status = CASE
        WHEN title = 'Catálogo de Servicios InHubFlow' AND approved_by_user_id IS NULL THEN 'draft'
        ELSE status
      END,
      updated_at = datetime('now')
    WHERE agent_id = ?
  `).run(workspaceOwnerId, legacy[0].id);

  return db.prepare("SELECT * FROM sdr_agents WHERE id = ?").get(legacy[0].id) as SdrAgentRecord;
}

export function ensureSdrAgent(
  db: Database.Database,
  requestedWorkspaceOwnerId?: string | null,
): SdrAgentWithVersion {
  applySdrSchema(db);
  const workspaceOwnerId = resolveWorkspaceOwnerId(db, requestedWorkspaceOwnerId);

  let agent = db.prepare(`
    SELECT * FROM sdr_agents
    WHERE workspace_owner_id = ? AND status != 'archived'
    ORDER BY created_at ASC
    LIMIT 1
  `).get(workspaceOwnerId) as SdrAgentRecord | undefined;

  agent ??= claimLegacyAgent(db, workspaceOwnerId) ?? undefined;

  if (!agent) {
    const agentId = randomUUID();
    const versionId = randomUUID();
    const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.7-flash";
    const defaultPrompt = `Eres el Asistente SDR de InHubFlow. Analiza mensajes comerciales y redacta únicamente respuestas respaldadas por fuentes de conocimiento aprobadas. Si la información es insuficiente, si se solicita una propuesta o condición especial, o si existe riesgo, deriva a una persona sin inventar datos.`;
    const defaultCompanyContext = `InHubFlow es una plataforma integral de prospección B2B y automatización de alcance multicanal (LinkedIn y Email).
Servicios y Capacidades Principales:
1. Prospección Inteligente B2B: Búsqueda avanzada de prospectos con Google X-Ray y Lead Finder con cero bloqueos ni captchas.
2. Integración con LinkedIn y Sales Navigator: Extracción segura de listas de contactos, visitas a perfiles, solicitudes de conexión personalizadas y mensajes directos respetando límites humanos.
3. Enriquecimiento de Datos: Conexión con Apollo.io para obtener emails corporativos verificados y datos detallados de empresas.
4. Campañas Multicanal Automatizadas: Secuencias inteligentes combinadas de visitas, conexiones en LinkedIn y correos fríos.
5. Asistente SDR con Inteligencia Artificial: Clasificación automática de respuestas entrantes, manejo de objeciones comerciales, redacción de respuestas personalizadas fundamentadas y derivación inmediata a humanos (Handoff) ante solicitudes complejas o personalizadas.
Políticas Comerciales:
- Planes y demostraciones: Se coordinan presentaciones personalizadas para empresas interesadas.
- Soporte y configuración: Acompañamiento en la integración de cuentas y calentamiento seguro de dominios de email.
- Privacidad y Seguridad: Todos los datos y credenciales se gestionan de forma segura y encriptada.`;
    const policyJson = JSON.stringify({
      company_context: defaultCompanyContext,
      handoff_rules: "Derivar ante información no respaldada, propuesta especial, negociación, riesgo o petición humana.",
    });
    const configJson = JSON.stringify({ custom_instructions: "" });
    const hash = revisionHash({ model, prompt: defaultPrompt, policyJson, configJson });
    const initialSourceId = randomUUID();

    db.transaction(() => {
      db.prepare(`
        INSERT INTO sdr_agents (
          id, workspace_owner_id, name, status, mode, default_language, model,
          active_version_id, confidence_threshold, max_auto_turns,
          created_by_user_id, runtime_enabled, provider_enabled, outbound_enabled
        ) VALUES (?, ?, ?, 'active', 'approval', 'es', ?, NULL, 0.85, 3, ?, 1, 1, 1)
      `).run(
        agentId,
        workspaceOwnerId,
        "Asistente SDR InHubFlow",
        model,
        workspaceOwnerId,
      );

      db.prepare(`
        INSERT INTO sdr_agent_versions (
          id, agent_id, version_number, model, system_prompt, policy_json,
          config_json, publication_state, revision_hash, published_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, 'published', ?, datetime('now'))
      `).run(versionId, agentId, model, defaultPrompt, policyJson, configJson, hash);

      db.prepare(
        "UPDATE sdr_agents SET active_version_id = ? WHERE id = ?",
      ).run(versionId, agentId);

      db.prepare(`
        INSERT INTO sdr_knowledge_sources (
          id, agent_id, workspace_owner_id, status, title, source_type,
          content, metadata_json
        ) VALUES (?, ?, ?, 'draft', 'Servicios y Capacidades de InHubFlow', 'catalog', ?, ?)
      `).run(
        initialSourceId,
        agentId,
        workspaceOwnerId,
        defaultCompanyContext,
        JSON.stringify({ content: defaultCompanyContext }),
      );
    })();

    try {
      approveKnowledgeSource(db, initialSourceId, workspaceOwnerId, workspaceOwnerId);
    } catch {
      // Non-fatal if schema or chunks table is still initializing
    }

    agent = db.prepare("SELECT * FROM sdr_agents WHERE id = ?").get(agentId) as SdrAgentRecord;
  }

  // Ensure at least one approved knowledge source exists for this agent
  try {
    const approvedCount = (db.prepare(`
      SELECT COUNT(*) AS count FROM sdr_knowledge_sources
      WHERE agent_id = ? AND workspace_owner_id = ? AND status = 'approved'
    `).get(agent.id, workspaceOwnerId) as { count: number } | undefined)?.count ?? 0;

    if (approvedCount === 0) {
      const draftSource = db.prepare(`
        SELECT id FROM sdr_knowledge_sources
        WHERE agent_id = ? AND workspace_owner_id = ? AND status = 'draft'
        ORDER BY created_at ASC LIMIT 1
      `).get(agent.id, workspaceOwnerId) as { id: string } | undefined;

      if (draftSource) {
        approveKnowledgeSource(db, draftSource.id, workspaceOwnerId, workspaceOwnerId);
      }
    }
  } catch {
    // Non-fatal if tables are initializing
  }

  let activeVersion: SdrAgentVersionRecord | null = null;
  if (agent.active_version_id) {
    activeVersion = (db.prepare(
      "SELECT * FROM sdr_agent_versions WHERE id = ? AND agent_id = ?",
    ).get(agent.active_version_id, agent.id) as SdrAgentVersionRecord | undefined) ?? null;
  }
  if (!activeVersion) {
    activeVersion = (db.prepare(`
      SELECT * FROM sdr_agent_versions
      WHERE agent_id = ?
      ORDER BY version_number DESC
      LIMIT 1
    `).get(agent.id) as SdrAgentVersionRecord | undefined) ?? null;
  }

  return { agent, activeVersion };
}
