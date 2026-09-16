import type { NextApiRequest, NextApiResponse } from "next";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import { unipile } from "@/lib/unipile/client";
import { accountHasSalesNavigator } from "@/lib/signals/scanners";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const accountId = typeof req.query.account_id === "string" ? req.query.account_id : "";
  if (!accountId) return res.status(400).json({ error: "account_id requerido" });
  const db = getDb();
  if (!canAccessLinkedInAccount(db, actor, accountId)) return res.status(404).json({ error: "Cuenta no encontrada" });
  try {
    const resolved = await resolveUnipileAccount(db, accountId, unipile);
    const account = resolved.account || await unipile.getAccount(resolved.unipileAccountId);
    const salesNavigator = accountHasSalesNavigator(account.connection_params);
    return res.status(200).json({
      accountReady: true,
      salesNavigator,
      supportedSignals: [
        "competitor_reactions", "high_intent_comments", "competitor_audience",
        "new_in_role", "internal_promotion", "active_poster", "keyword_intent", "hiring_spree",
        ...(salesNavigator ? ["company_growth", "profile_viewers"] : []),
      ],
    });
  } catch (error) {
    return res.status(502).json({ accountReady: false, salesNavigator: false, supportedSignals: [], error: error instanceof Error ? error.message : "Cuenta no disponible" });
  }
}
