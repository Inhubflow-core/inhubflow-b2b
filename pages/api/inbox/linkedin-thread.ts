import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { canAccessLinkedInAccount, requireApiActor, targetBelongsToLinkedInAccount } from "@/lib/authz";
import { getCampaignLinkedInThread } from "@/lib/linkedin/campaign-inbox";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }
  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const targetId = typeof req.query.targetId === "string" ? req.query.targetId.trim() : "";
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId.trim() : "";
  const threadId = typeof req.query.threadId === "string" ? req.query.threadId.trim() : undefined;

  if (!targetId || !accountId) {
    return res.status(400).json({ error: "targetId and accountId are required" });
  }

  const db = getDb();
  if (
    !canAccessLinkedInAccount(db, actor, accountId)
    || !targetBelongsToLinkedInAccount(db, targetId, accountId)
  ) {
    return res.status(404).json({ error: "LinkedIn conversation not found" });
  }
  let messages = getCampaignLinkedInThread(db, targetId, accountId, threadId);
  if (messages.length === 0 && threadId) {
    // Fallback to target-level messages for this account if exact thread id is not yet populated
    messages = getCampaignLinkedInThread(db, targetId, accountId);
  }
  return res.status(200).json({ ok: true, messages });
}
