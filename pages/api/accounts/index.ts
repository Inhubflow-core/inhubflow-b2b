import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";
import { getInstanceSettings } from "@/lib/auto-seed";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const db = getDb();
    const session = await getServerSession(req, res, authOptions);
    const currentUser = session?.user as any;

    // Excludes cookies_json — the frontend never uses the raw session blob, only
    // is_authenticated, so there's no reason to ship it (even encrypted) to the client.
    const ACCOUNT_COLUMNS = `a.id, a.name, a.email, a.is_authenticated, a.unipile_status AS linkedin_connection_status, a.daily_connection_limit, a.daily_message_limit, a.daily_inmail_limit,
      a.active_hours_start, a.active_hours_end, a.timezone, a.working_days, a.created_at,
      a.inbox_synced_at, a.accepted_sync_at, a.li_connections, a.li_pending, a.li_profile_views,
      a.li_stats_synced_at, a.connections_synced_through_ms, a.owner_id, a.assigned_user_id`;

    if (req.method === "GET") {
      // 1. If user is a team member with an explicitly assigned account:
      if (currentUser?.owner_id && currentUser?.assigned_account_id) {
        const accounts = db.prepare(`
          SELECT ${ACCOUNT_COLUMNS},
            (SELECT COUNT(*) FROM runs r WHERE r.account_id = a.id AND r.status IN ('running', 'paused')) AS active_run_count
          FROM accounts a 
          WHERE a.id = ?
          ORDER BY a.created_at DESC
        `).all(currentUser.assigned_account_id);
        return res.json(accounts);
      }

      // 2. If user is a team member, filter by assigned_user_id
      if (currentUser?.owner_id) {
        const accounts = db.prepare(`
          SELECT ${ACCOUNT_COLUMNS},
            (SELECT COUNT(*) FROM runs r WHERE r.account_id = a.id AND r.status IN ('running', 'paused')) AS active_run_count
          FROM accounts a 
          WHERE a.assigned_user_id = ?
          ORDER BY a.created_at DESC
        `).all(currentUser.id);
        return res.json(accounts);
      }

      const isSuperAdmin =
        currentUser?.role === "admin" ||
        currentUser?.email?.trim().toLowerCase() === "inhubflow@gmail.com";

      // 3. SuperAdmin: Sees all accounts
      if (isSuperAdmin) {
        const accounts = db.prepare(`
          SELECT ${ACCOUNT_COLUMNS},
            (SELECT COUNT(*) FROM runs r WHERE r.account_id = a.id AND r.status IN ('running', 'paused')) AS active_run_count
          FROM accounts a ORDER BY a.created_at DESC
        `).all();
        return res.json(accounts);
      }

      // 4. Workspace Owner (Client): Sees only their accounts
      const workspaceOwnerId = currentUser?.owner_id || currentUser?.id;
      const accounts = db.prepare(`
        SELECT ${ACCOUNT_COLUMNS},
          (SELECT COUNT(*) FROM runs r WHERE r.account_id = a.id AND r.status IN ('running', 'paused')) AS active_run_count
        FROM accounts a 
        WHERE a.owner_id = ? OR a.assigned_user_id = ?
        ORDER BY a.created_at DESC
      `).all(workspaceOwnerId, currentUser?.id);
      return res.json(accounts);
    }

    if (req.method === "POST") {
      const {
        name,
        email,
        daily_connection_limit = 20,
        daily_message_limit = 20,
        daily_inmail_limit = 20,
        active_hours_start = 9,
        active_hours_end = 18,
        timezone = "UTC",
        working_days = "1,2,3,4,5",
      } = req.body;

      if (!name || !email) return res.status(400).json({ error: "Nombre y correo son obligatorios" });

      // Enforce safe account limits (Max 20/day)
      const safeConnLimit = Math.min(20, Math.max(1, Number(daily_connection_limit) || 20));
      const safeMsgLimit = Math.min(20, Math.max(1, Number(daily_message_limit) || 20));
      const safeInmailLimit = Math.min(20, Math.max(0, Number(daily_inmail_limit) || 20));

      // Check slots limit
      try {
        const { slotsLimit: instanceLimit } = getInstanceSettings(db);
        const isSuperAdmin =
          currentUser?.role === "admin" ||
          currentUser?.email?.trim().toLowerCase() === "inhubflow@gmail.com";
        const workspaceOwnerId = currentUser?.owner_id || currentUser?.id;
        
        let effectiveLimit = instanceLimit;
        if (isSuperAdmin) {
          effectiveLimit = 999;
        } else if (workspaceOwnerId) {
          const ownerRow = db.prepare("SELECT slots_limit FROM users WHERE id = ?").get(workspaceOwnerId) as { slots_limit?: number } | undefined;
          effectiveLimit = ownerRow?.slots_limit || (session?.user as { slots_limit?: number })?.slots_limit || instanceLimit;
        }

        if (!isSuperAdmin) {
          const countRow = db.prepare(
            "SELECT COUNT(*) as count FROM accounts WHERE owner_id = ? OR assigned_user_id = ?"
          ).get(workspaceOwnerId, currentUser?.id) as { count: number };
          if (countRow && countRow.count >= effectiveLimit) {
            return res.status(403).json({
              error: `Has alcanzado el límite de ${effectiveLimit} slots/cuentas de tu suscripción actual.`,
              slotsLimit: effectiveLimit,
              currentCount: countRow.count,
            });
          }
        }
      } catch (e) {
        console.log("Slot check notice:", e);
      }

      try {
        const id = randomUUID();
        const ownerId = currentUser?.owner_id || currentUser?.id || null;
        const assignedUserId = currentUser?.owner_id ? currentUser.id : null;

        db
          .prepare(
            `INSERT INTO accounts (
              id, name, email, daily_connection_limit, daily_message_limit, daily_inmail_limit,
              active_hours_start, active_hours_end, timezone, working_days, owner_id, assigned_user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            name.trim(),
            email.trim().toLowerCase(),
            safeConnLimit,
            safeMsgLimit,
            safeInmailLimit,
            active_hours_start,
            active_hours_end,
            timezone,
            working_days,
            ownerId,
            assignedUserId
          );

        // If a team member connected this account, bind it to their user profile
        if (currentUser?.owner_id) {
          db.prepare("UPDATE users SET assigned_account_id = ? WHERE id = ?").run(id, currentUser.id);
        }

        const account = db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts a WHERE a.id = ?`).get(id);
        return res.status(201).json(account);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        if (msg.includes("UNIQUE")) {
          return res.status(409).json({ error: "Ya existe una cuenta con este correo" });
        }
        return res.status(500).json({ error: msg });
      }
    }

    return res.status(405).json({ error: "Método no permitido" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return res.status(500).json({ error: msg });
  }
}
