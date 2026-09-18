import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { requireApiActor, canManageSdrAgent } from "@/lib/authz";
import { ensureSdrAgent } from "@/lib/sdr-agent/seed";

const PROMOTION_GATES = [
  { key: "shadow_evaluated", label: "Evaluación en Modo Shadow", desc: "El agente ha clasificado mensajes en modo shadow sin discrepancias críticas." },
  { key: "approval_canary_passed", label: "Canary de Aprobación Humana", desc: "Respuestas aprobadas por humanos sin alucinaciones ni objeciones no resueltas." },
  { key: "takeover_race_passed", label: "Control de Concurrencia (Takeover)", desc: "El mecanismo de takeover y control_epoch bloquea con éxito respuestas huérfanas." },
  { key: "kill_switch_drill_passed", label: "Simulacro de Kill Switch", desc: "El corte de emergencia frena instantáneamente el despacho de mensajes." },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const db = getDb();
  const { agent } = ensureSdrAgent(db, actor.workspaceOwnerId);
  if (!canManageSdrAgent(db, actor, agent.id)) {
    return res.status(403).json({ error: "No autorizado para gestionar gates de promoción" });
  }

  if (req.method === "GET") {
    const existing = db.prepare(`
      SELECT gate_key, passed, evidence_json, verified_at, verified_by_user_id
      FROM sdr_promotion_gates
      WHERE agent_id = ? AND capability = 'auto'
    `).all(agent.id) as Array<{
      gate_key: string;
      passed: number;
      evidence_json: string | null;
      verified_at: string | null;
      verified_by_user_id: string | null;
    }>;

    const mappedGates = PROMOTION_GATES.map((g) => {
      const match = existing.find((e) => e.gate_key === g.key);
      return {
        ...g,
        passed: match ? match.passed === 1 : false,
        evidence: match?.evidence_json ? JSON.parse(match.evidence_json) : null,
        verified_at: match?.verified_at ?? null,
      };
    });

    const allPassed = mappedGates.every((g) => g.passed);

    return res.status(200).json({
      gates: mappedGates,
      allPassed,
      canEnableAuto: allPassed,
    });
  }

  if (req.method === "POST") {
    const { gate_key, evidence } = req.body || {};
    if (!gate_key || typeof gate_key !== "string") {
      return res.status(400).json({ error: "gate_key is required" });
    }

    const validKeys = PROMOTION_GATES.map((g) => g.key);
    if (!validKeys.includes(gate_key)) {
      return res.status(400).json({ error: `Invalid gate_key. Must be one of: ${validKeys.join(", ")}` });
    }

    const evidenceJson = evidence ? JSON.stringify(evidence) : JSON.stringify({ verifiedManually: true, at: new Date().toISOString() });
    const id = randomUUID();

    db.prepare(`
      INSERT INTO sdr_promotion_gates (
        id, workspace_owner_id, agent_id, capability, gate_key,
        passed, evidence_json, verified_at, verified_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'auto', ?, 1, ?, datetime('now'), ?, datetime('now'), datetime('now'))
      ON CONFLICT(agent_id, capability, gate_key) DO UPDATE SET
        passed = 1,
        evidence_json = excluded.evidence_json,
        verified_at = datetime('now'),
        verified_by_user_id = excluded.verified_by_user_id,
        updated_at = datetime('now')
    `).run(id, actor.workspaceOwnerId, agent.id, gate_key, evidenceJson, actor.id);

    return res.status(200).json({ ok: true, gate_key, passed: true });
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: "Method not allowed" });
}
