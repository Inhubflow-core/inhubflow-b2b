import type { NextApiRequest, NextApiResponse } from "next";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { createSdrBridge } from "@/lib/sdr-agent/bridge";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const accountId = typeof req.query.account_id === "string" ? req.query.account_id : "";
  const listId = typeof req.query.list_id === "string" ? req.query.list_id : "";
  const workflowId = typeof req.query.workflow_id === "string" ? req.query.workflow_id : "";
  const db = getDb();
  const blockers: string[] = [];
  if (!accountId || !canAccessLinkedInAccount(db, actor, accountId)) blockers.push("linkedin_account_not_ready");
  if (!listId || !db.prepare("SELECT 1 FROM lists WHERE id = ?").get(listId)) blockers.push("target_list_required");
  if (!workflowId || !db.prepare("SELECT 1 FROM workflows WHERE id = ? AND COALESCE(is_archived, 0) = 0").get(workflowId)) {
    blockers.push("target_workflow_required");
  } else if (!db.prepare(`
    SELECT 1 FROM workflow_steps
    WHERE workflow_id = ? AND track = 'linkedin' AND step_type = 'message' AND enabled = 1 LIMIT 1
  `).get(workflowId)) {
    blockers.push("linkedin_message_step_required");
  }
  const sdr = createSdrBridge({ getDatabase: () => db }).getStatus(actor.workspaceOwnerId);
  if (!sdr.linkedinOutboundEnabled || !sdr.providerEnabled) blockers.push(...(sdr.blockers || []));
  return res.status(200).json({
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    sdrReady: Boolean(sdr.linkedinOutboundEnabled && sdr.providerEnabled),
  });
}
