import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor, canManageSdrAgent } from "@/lib/authz";
import { ensureSdrAgent } from "@/lib/sdr-agent/seed";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const db = getDb();
  const { agent } = ensureSdrAgent(db, actor.workspaceOwnerId);
  if (!canManageSdrAgent(db, actor, agent.id)) {
    return res.status(403).json({ error: "No autorizado para ver acciones del SDR" });
  }

  if (req.method === "GET") {
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
    const stateFilter = status === "all"
      ? "1=1"
      : status === "completed"
      ? "a.state = 'completed'"
      : "a.state IN ('proposed', 'waiting_approval')";

    const actions = db.prepare(`
      SELECT
        a.id, a.thread_id, a.message_id, a.action_type, a.state,
        a.control_epoch, a.payload_json, a.edited_payload_json,
        a.delivery_status, a.created_at, a.updated_at,
        t.id AS target_id, t.full_name AS target_name, t.company AS target_company,
        t.linkedin_url AS target_linkedin, t.email AS target_email,
        t.profile_image_url AS target_image_url,
        th.channel, th.ai_turn_count,
        d.intent, d.confidence, d.risk_level, d.requires_human, d.reason_code
      FROM sdr_actions a
      JOIN sdr_threads th ON th.id = a.thread_id
      LEFT JOIN targets t ON t.id = th.target_id
      LEFT JOIN sdr_decisions d ON d.id = a.decision_id
      WHERE a.workspace_owner_id = ? AND ${stateFilter}
      ORDER BY a.created_at DESC
      LIMIT 50
    `).all(actor.workspaceOwnerId) as Array<{
      id: string;
      thread_id: string;
      message_id: string | null;
      action_type: string;
      state: string;
      control_epoch: number;
      payload_json: string;
      edited_payload_json: string | null;
      delivery_status: string;
      created_at: string;
      updated_at: string;
      target_id: string | null;
      target_name: string | null;
      target_company: string | null;
      target_linkedin: string | null;
      target_email: string | null;
      target_image_url: string | null;
      channel: string;
      ai_turn_count: number;
      intent: string | null;
      confidence: number | null;
      risk_level: string | null;
      requires_human: number | null;
      reason_code: string | null;
    }>;

    const mapped = actions.map((act) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(act.edited_payload_json || act.payload_json || "{}");
      } catch {
        payload = {};
      }
      return {
        ...act,
        payload,
        suggested_reply: payload.suggested_reply || payload.body || "",
      };
    });

    return res.status(200).json({
      actions: mapped,
      count: mapped.length,
    });
  }

  res.setHeader("Allow", ["GET"]);
  return res.status(405).json({ error: "Method not allowed" });
}
