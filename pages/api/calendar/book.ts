import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { applyCalendarSchema } from "@/lib/calendar/schema";
import { applyTagsSchema } from "@/lib/tags/schema";
import { applyPipelineSchema } from "@/lib/pipeline/schema";
import { applyTag } from "@/lib/tags/tags-service";
import { findSlotCollision } from "@/lib/calendar/availability";
import { getCalendarSettings } from "@/lib/calendar/settings";
import { createCalendarEvent } from "@/lib/calendar/calendar-service";
import { formatInZone } from "@/lib/calendar/time";

/**
 * Public booking endpoint (Calendly-style). Unauthenticated by design, so every
 * field is validated and the slot is re-checked inside the same transaction that
 * writes the event — otherwise two simultaneous bookings both pass the check.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, email, start_time, end_time, phone, company, notes } = req.body ?? {};

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "El nombre es obligatorio" });
  }
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Email corporativo válido requerido" });
  }
  if (!start_time || !end_time) {
    return res.status(400).json({ error: "Fecha y hora de inicio/fin requeridas" });
  }

  const slotStart = new Date(start_time).getTime();
  const slotEnd = new Date(end_time).getTime();
  if (!Number.isFinite(slotStart) || !Number.isFinite(slotEnd) || slotEnd <= slotStart) {
    return res.status(400).json({ error: "Rango de horario inválido" });
  }
  // A public form must not be able to book years into the past/future.
  const maxHorizonMs = Date.now() + 400 * 86_400_000;
  if (slotStart < Date.now() - 86_400_000 || slotStart > maxHorizonMs) {
    return res.status(400).json({ error: "La fecha seleccionada está fuera del rango permitido" });
  }

  const db = getDb();
  applyCalendarSchema(db);
  applyPipelineSchema(db);
  applyTagsSchema(db);

  const settings = getCalendarSettings(db);

  try {
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    const result = db.transaction(() => {
      // 1. Re-check the slot inside the transaction to close the double-book race.
      const collision = findSlotCollision(db, slotStart, slotEnd);
      if (collision) {
        return { conflict: true as const };
      }

      // 2. Find or create the lead. It enters the funnel right away so a booking
      //    never produces an invisible contact.
      const existingTarget = db
        .prepare("SELECT id FROM targets WHERE lower(email) = ? LIMIT 1")
        .get(cleanEmail) as { id: string } | undefined;

      let targetId: string;
      let isNewLead = false;
      const now = new Date().toISOString();

      if (existingTarget) {
        targetId = existingTarget.id;
        if (company || phone) {
          db.prepare(`
            UPDATE targets
            SET company = coalesce(?, company),
                phone = coalesce(?, phone),
                updated_at = ?
            WHERE id = ?
          `).run(company?.trim() || null, phone?.trim() || null, now, targetId);
        }
      } else {
        targetId = `tgt_${randomUUID()}`;
        isNewLead = true;
        db.prepare(`
          INSERT INTO targets (
            id, full_name, email, phone, company, stage_id, stage_updated_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'stage_meeting', ?, ?, ?)
        `).run(
          targetId,
          cleanName,
          cleanEmail,
          phone?.trim() || null,
          company?.trim() || null,
          now,
          now,
          now
        );
      }

      // 3. Video link: honour the configured default instead of inventing a room.
      const meetingLink =
        (typeof settings.default_meeting_link === "string" && settings.default_meeting_link.trim()) ||
        null;

      const title = `Reunión Comercial: ${cleanName}${company ? ` (${company.trim()})` : ""}`.trim();

      // 4. Create the event (advances the lead to "Reunión Agendada").
      const event = createCalendarEvent(
        db,
        {
          title,
          description: notes?.trim() || "Reserva agendada a través de la página pública de reservas.",
          start_time: new Date(slotStart).toISOString(),
          end_time: new Date(slotEnd).toISOString(),
          target_id: targetId,
          meeting_link: meetingLink,
          status: "confirmed",
          channel: "sdr_ai",
          source: "public_booking",
          auto_advance_pipeline: true,
        },
        { workspaceOwnerId: null }
      );

      // 5. Tag the lead so the funnel reflects the outcome, whether or not the
      //    stage trigger fired (e.g. it was already past "meeting").
      try {
        applyTag(db, targetId, "meeting", { source: "rule", appliedBy: "public_booking" });
        applyTag(db, targetId, "contacted", { source: "rule", appliedBy: "public_booking" });
      } catch (err) {
        console.warn("[calendar/book] tagging skipped:", err);
      }

      return { conflict: false as const, event, targetId, isNewLead, meetingLink };
    })();

    if (result.conflict) {
      return res.status(409).json({
        error: "Este horario ya fue reservado. Por favor selecciona otro horario disponible.",
        code: "slot_taken",
      });
    }

    const { event, targetId, meetingLink } = result;

    // 6. Confirmation email, best-effort (never blocks the booking).
    try {
      const emailAcc = db.prepare("SELECT * FROM email_accounts LIMIT 1").get() as
        | Record<string, unknown>
        | undefined;
      if (emailAcc && typeof emailAcc.smtp_host === "string" && emailAcc.smtp_host) {
        const { sendEmail } = await import("@/lib/email/sender");
        const formattedDate = formatInZone(slotStart, settings.timezone);
        const subject = `Confirmación de Reunión: ${event.title}`;
        const body = [
          `Hola ${cleanName},`,
          "",
          "Tu reunión ha sido agendada con éxito.",
          "",
          `Fecha y hora: ${formattedDate} (${settings.timezone})`,
          meetingLink ? `Enlace de videollamada: ${meetingLink}` : "Te enviaremos el enlace de la videollamada antes de la reunión.",
          "",
          "¡Nos vemos pronto!",
          "Equipo InHubFlow",
        ].join("\n");

        void sendEmail(emailAcc as never, cleanEmail, subject, body).catch((e) =>
          console.warn("[calendar/book] Failed to dispatch email confirmation:", e)
        );
      }
    } catch (emailErr) {
      console.warn("[calendar/book] Email confirmation skipped:", emailErr);
    }

    return res.status(201).json({
      ok: true,
      event,
      target_id: targetId,
      meeting_link: meetingLink,
      timezone: settings.timezone,
    });
  } catch (err: unknown) {
    console.error("[calendar/book] error:", err);
    return res.status(500).json({ error: "Error al procesar la reserva" });
  }
}
