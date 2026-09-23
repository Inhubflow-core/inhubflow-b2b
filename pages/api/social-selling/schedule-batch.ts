import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

/**
 * Calcula las próximas N fechas que caen en Lunes (1), Miércoles (3) o Viernes (5)
 */
function getNextPublishingDates(count: number, startDate = new Date(), timeStr = "09:00"): Date[] {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const targetDays = [1, 3, 5]; // 1: Lun, 3: Mié, 5: Vie

  const dates: Date[] = [];
  const current = new Date(startDate);
  current.setHours(hours || 9, minutes || 0, 0, 0);

  // Si hoy ya pasó la hora o es fin de semana, comenzar a partir de mañana
  if (current.getTime() <= Date.now()) {
    current.setDate(current.getDate() + 1);
  }

  while (dates.length < count) {
    const dayOfWeek = current.getDay();
    if (targetDays.includes(dayOfWeek)) {
      dates.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const {
    posts,
    account_id,
    start_date,
    publishing_time = "09:00",
    topic,
  } = req.body;

  if (!account_id) {
    return res.status(400).json({ error: "Debe seleccionar una cuenta de LinkedIn para publicar" });
  }

  if (!Array.isArray(posts) || posts.length === 0) {
    return res.status(400).json({ error: "Debe enviar al menos un post para programar" });
  }

  const db = getDb();
  const [hStr, mStr] = (publishing_time || "10:00").split(":");
  const hours = parseInt(hStr, 10) || 10;
  const minutes = parseInt(mStr, 10) || 0;
  const baseStart = start_date ? new Date(start_date) : new Date();

  // Obtener publicaciones existentes de la cuenta para no sobreescribir ni repetir días
  const existing = db.prepare(
    "SELECT scheduled_at FROM social_selling_posts WHERE account_id = ? AND status != 'failed'"
  ).all(account_id) as Array<{ scheduled_at: string }>;

  const { getNextBatchPublishingSlots } = await import("@/lib/social-selling/slots");
  const publishingDates = getNextBatchPublishingSlots(posts.length, existing, hours, minutes, baseStart);

  try {
    const createdPosts: any[] = [];

    const insertStmt = db.prepare(`
      INSERT INTO social_selling_posts (
        id, user_id, account_id, topic, content, image_prompt, media_url, media_type,
        original_post_url, original_author, original_content, original_metrics_json,
        scheduled_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
    `);

    db.transaction(() => {
      posts.forEach((postItem: any, index: number) => {
        const id = randomUUID();
        const scheduledDate = publishingDates[index] || new Date(Date.now() + 86400000 * (index + 1));
        const scheduledIso = scheduledDate.toISOString();

        const metricsJson = postItem.original_metrics ? JSON.stringify(postItem.original_metrics) : null;

        insertStmt.run(
          id,
          (session.user as any)?.id || null,
          postItem.account_id || account_id,
          topic || postItem.topic || null,
          postItem.content.trim(),
          postItem.image_prompt || null,
          postItem.media_url || null,
          postItem.media_type || (postItem.media_url ? "image" : "none"),
          postItem.original_post_url || null,
          postItem.original_author || null,
          postItem.original_content || null,
          metricsJson,
          scheduledIso
        );

        createdPosts.push({
          id,
          scheduled_at: scheduledIso,
          content: postItem.content,
        });
      });
    })();

    return res.status(201).json({
      success: true,
      scheduled_count: createdPosts.length,
      posts: createdPosts,
    });
  } catch (error) {
    console.error("[api/social-selling/schedule-batch] Error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Error al programar lote de publicaciones",
    });
  }
}
