import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const db = getDb();
    const body = (req.body || {}) as { target_ids?: string[]; ids?: string[] };
    const rawIds = body.target_ids || body.ids;

    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return res.status(400).json({ error: "target_ids must be a non-empty array" });
    }

    const ids = Array.from(new Set(rawIds.map((id) => String(id).trim()).filter(Boolean)));
    if (ids.length === 0) {
      return res.status(400).json({ error: "No valid IDs provided" });
    }

    const placeholders = ids.map(() => "?").join(",");

    const resetTx = db.transaction(() => {
      // 1. Limpiar estados en tabla targets (dejar virgen como nuevo prospecto)
      db.prepare(`
        UPDATE targets SET
          connection_requested_at = NULL,
          connected_at = NULL,
          message_sent_at = NULL,
          last_replied_at = NULL,
          degree = NULL,
          last_replied_account_id = NULL,
          unipile_chat_id = NULL
        WHERE id IN (${placeholders})
      `).run(...ids);

      // 2. Limpiar vinculaciones específicas por cuenta en linkedin_target_accounts
      try {
        db.prepare(`
          UPDATE linkedin_target_accounts SET
            connection_requested_at = NULL,
            connected_at = NULL,
            message_sent_at = NULL,
            degree = NULL,
            unipile_chat_id = NULL
          WHERE target_id IN (${placeholders})
        `).run(...ids);
      } catch {}

      // 3. Limpiar entregas de pasos en linkedin_step_deliveries
      try {
        db.prepare(`DELETE FROM linkedin_step_deliveries WHERE target_id IN (${placeholders})`).run(...ids);
      } catch {}

      // 4. Limpiar historial de ejecución de workflows para permitir reenrolamiento
      try {
        db.prepare(`
          DELETE FROM run_profile_tracks 
          WHERE run_profile_id IN (SELECT id FROM run_profiles WHERE target_id IN (${placeholders}))
        `).run(...ids);
        db.prepare(`DELETE FROM run_profiles WHERE target_id IN (${placeholders})`).run(...ids);
      } catch {}

      // 5. Limpiar hilos y conversaciones del Asistente SDR
      try {
        db.prepare(`DELETE FROM sdr_threads WHERE target_id IN (${placeholders})`).run(...ids);
      } catch {}

      // 6. Limpiar intentos de conexión registrados
      try {
        db.prepare(`DELETE FROM linkedin_connection_attempts WHERE target_id IN (${placeholders})`).run(...ids);
      } catch {}
    });

    resetTx();

    return res.json({
      ok: true,
      message: `${ids.length} contactos reseteados a estado inicial para pruebas`,
      reset_count: ids.length,
    });
  } catch (err: any) {
    console.error("[POST /api/targets/reset-status error]:", err);
    return res.status(500).json({ error: err?.message || "Error al resetear contactos" });
  }
}
