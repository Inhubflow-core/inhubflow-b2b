import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { canAccessSdrThread, requireApiActor } from "@/lib/authz";
import { releaseHumanControl } from "@/lib/sdr-agent/handoff";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const threadId = Array.isArray(req.query.threadId) ? req.query.threadId[0] : req.query.threadId;
  if (!threadId) return res.status(400).json({ error: "Thread id is required" });
  const db = getDb();
  if (!canAccessSdrThread(db, actor, threadId)) return res.status(404).json({ error: "Thread not found" });
  const nextState = req.body?.nextState === "WAITING_LEAD" ? "WAITING_LEAD" : "AI_ACTIVE";
  try {
    const result = releaseHumanControl(db, {
      threadId,
      actorUserId: actor.id,
      workspaceOwnerId: actor.workspaceOwnerId,
      allowAdministrativeOverride: actor.isWorkspaceAdmin,
      nextState,
    });

    // Si hay un mensaje entrante reciente que no ha sido clasificado, encolar su clasificación para que la IA lo procese ahora
    try {
      const lastInbound = db.prepare(`
        SELECT id, external_message_id FROM sdr_messages
        WHERE thread_id = ? AND direction = 'inbound'
        ORDER BY datetime(received_at) DESC LIMIT 1
      `).get(threadId) as { id: string; external_message_id: string } | undefined;

      if (lastInbound) {
        const hasDecision = db.prepare("SELECT 1 FROM sdr_decisions WHERE message_id = ?").get(lastInbound.id);
        if (!hasDecision) {
          const { enqueueSdrJob } = await import("@/lib/sdr-agent/jobs");
          enqueueSdrJob(db, {
            workspaceOwnerId: actor.workspaceOwnerId,
            threadId,
            messageId: lastInbound.id,
            controlEpoch: result.controlEpoch,
            jobType: "classify",
            idempotencyKey: `classify:${threadId}:${lastInbound.external_message_id}`,
            payload: { messageId: lastInbound.id, threadId },
          });
        }
      }
    } catch (err) {
      console.warn("[sdr/release] Error encolando clasificacion pendiente:", err);
    }

    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Unable to release control" });
  }
}
