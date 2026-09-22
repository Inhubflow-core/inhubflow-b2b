import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

// Excludes cookies_json — the frontend never uses the raw session blob, only
// is_authenticated, so there's no reason to ship it (even encrypted) to the client.
const ACCOUNT_COLUMNS = `id, name, email, is_authenticated, unipile_status AS linkedin_connection_status, daily_connection_limit, daily_message_limit, daily_inmail_limit,
  active_hours_start, active_hours_end, timezone, working_days, created_at,
  inbox_synced_at, accepted_sync_at, li_connections, li_pending, li_profile_views,
  li_stats_synced_at, connections_synced_through_ms`;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const id = req.query.id as string;

  if (req.method === "GET") {
    const account = db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`).get(id);
    if (!account) return res.status(404).json({ error: "Not found" });
    return res.json(account);
  }

  if (req.method === "PUT") {
    const { name, email, daily_connection_limit, daily_message_limit, daily_inmail_limit, active_hours_start, active_hours_end, timezone, working_days } = req.body;

    const safeConn = daily_connection_limit !== undefined
      ? Math.min(20, Math.max(1, Number(daily_connection_limit)))
      : null;
    const safeMsg = daily_message_limit !== undefined
      ? Math.min(20, Math.max(1, Number(daily_message_limit)))
      : null;
    const safeInmail = daily_inmail_limit !== undefined
      ? Math.min(20, Math.max(0, Number(daily_inmail_limit)))
      : null;

    db.prepare(
      `UPDATE accounts SET
        name = COALESCE(?, name),
        email = COALESCE(?, email),
        daily_connection_limit = COALESCE(?, daily_connection_limit),
        daily_message_limit = COALESCE(?, daily_message_limit),
        daily_inmail_limit = COALESCE(?, daily_inmail_limit),
        active_hours_start = COALESCE(?, active_hours_start),
        active_hours_end = COALESCE(?, active_hours_end),
        timezone = COALESCE(?, timezone),
        working_days = COALESCE(?, working_days)
       WHERE id = ?`
    ).run(name, email, safeConn, safeMsg, safeInmail, active_hours_start, active_hours_end, timezone, working_days, id);
    return res.json(db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`).get(id));
  }

  if (req.method === "DELETE") {
    try {
      const account = db.prepare("SELECT id, unipile_account_id FROM accounts WHERE id = ?").get(id) as
        | { id: string; unipile_account_id?: string | null }
        | undefined;

      if (!account) return res.status(404).json({ error: "Cuenta no encontrada" });

      // Borrado ordenado en cascada dentro de una transacción para satisfacer las restricciones FK de SQLite
      const cascadeDelete = db.transaction(() => {
        // 1. Limpiar referencias foráneas que no tienen ON DELETE CASCADE
        db.prepare("UPDATE targets SET last_replied_account_id = NULL WHERE last_replied_account_id = ?").run(id);
        db.prepare("UPDATE users SET assigned_account_id = NULL WHERE assigned_account_id = ?").run(id);
        db.prepare("UPDATE runs SET account_id = NULL WHERE account_id = ?").run(id);
        try { db.prepare("UPDATE team_invitations SET assigned_account_id = NULL WHERE assigned_account_id = ?").run(id); } catch {}

        // Tablas auxiliares / módulos opcionales
        try { db.prepare("UPDATE signal_monitors SET account_id = NULL WHERE account_id = ?").run(id); } catch {}
        try { db.prepare("UPDATE list_imports SET account_id = NULL WHERE account_id = ?").run(id); } catch {}

        // Módulo SDR (sdr_threads tiene un CHECK constraint que exige linkedin_account_id != NULL si channel='linkedin', por lo que debe borrarse explícitamente)
        try { db.prepare("DELETE FROM sdr_agent_accounts WHERE account_id = ?").run(id); } catch {}
        try { db.prepare("DELETE FROM sdr_quota_reservations WHERE account_id = ?").run(id); } catch {}
        try { db.prepare("DELETE FROM sdr_threads WHERE linkedin_account_id = ?").run(id); } catch {}

        // LinkedIn y Unipile dependencias directas
        try { db.prepare("DELETE FROM linkedin_target_accounts WHERE account_id = ?").run(id); } catch {}
        try { db.prepare("DELETE FROM linkedin_step_deliveries WHERE account_id = ?").run(id); } catch {}
        try { db.prepare("DELETE FROM linkedin_connection_attempts WHERE account_id = ?").run(id); } catch {}
        try { db.prepare("DELETE FROM linkedin_inbox_messages WHERE account_id = ?").run(id); } catch {}
        try { db.prepare("DELETE FROM account_daily_usage WHERE account_id = ?").run(id); } catch {}

        // 2. Eliminar la cuenta de accounts
        db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
      });

      cascadeDelete();

      // 3. Eliminar la cuenta de Unipile de forma asíncrona si tenía unipile_account_id
      if (account.unipile_account_id) {
        import("@/lib/unipile/client")
          .then(({ unipile }) => unipile.deleteAccount(account.unipile_account_id!))
          .catch((err) => {
            console.warn("[deleteAccount] No se pudo dar de baja la cuenta del motor cloud:", err?.message || err);
          });
      }

      return res.status(204).end();
    } catch (err: any) {
      console.error("[deleteAccount error]:", err);
      return res.status(500).json({ error: err?.message || "Error al eliminar la cuenta" });
    }
  }

  res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
  res.status(405).end();
}
