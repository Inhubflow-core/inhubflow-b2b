import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { applyCalendarSchema } from "@/lib/calendar/schema";
import { computeAvailability } from "@/lib/calendar/availability";

/**
 * Public availability used by /book. No session is required (the booking page is
 * public), and the response only exposes free/busy times — never prospect names
 * or any other CRM data.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { date } = req.query;
  if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Parámetro date en formato YYYY-MM-DD requerido" });
  }

  const db = getDb();
  applyCalendarSchema(db);

  try {
    const result = computeAvailability(db, date);
    res.setHeader("Cache-Control", "no-store");
    return res.json(result);
  } catch (err: unknown) {
    console.error("[calendar/availability] error:", err);
    return res.status(500).json({ error: "Error al calcular disponibilidad" });
  }
}
