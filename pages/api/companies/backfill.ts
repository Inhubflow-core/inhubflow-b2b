import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor } from "@/lib/authz";
import { backfillUnlinkedTargets } from "@/lib/companies/service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const db = getDb();
  const result = backfillUnlinkedTargets(
    db,
    actor.isSuperAdmin ? null : actor.workspaceOwnerId
  );

  return res.json({
    success: true,
    ...result,
  });
}
