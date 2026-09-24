import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";
import { isAccountAuthorized } from "@/lib/social-selling/auth";
import { getNextBatchPublishingSlots } from "@/lib/social-selling/slots";

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

  // Validar de antemano que todos los posts contengan texto válido antes de iniciar la transacción
  for (let i = 0; i < posts.length; i++) {
    const item = posts[i];
    if (!item || typeof item.content !== "string" || !item.content.trim()) {
      return res.status(400).json({ error: `La publicación en posición ${i + 1} no tiene contenido de texto válido` });
    }
  }

  const db = getDb();

  // Validar autorización de la cuenta emisora
  if (!isAccountAuthorized(db, session.user, account_id)) {
    return res.status(403).json({ error: "No tienes autorización para programar en esta cuenta de LinkedIn" });
  }

  const [hStr, mStr] = (publishing_time || "10:00").split(":");
  const hours = parseInt(hStr, 10) || 10;
  const minutes = parseInt(mStr, 10) || 0;
  
  let baseStart: Date;
  if (start_date) {
    const parsed = new Date(start_date);
    baseStart = isNaN(parsed.getTime()) ? new Date() : parsed;
  } else {
    baseStart = new Date();
  }

  // Obtener publicaciones existentes de la cuenta para no sobreescribir ni repetir días
  const existing = db.prepare(
    "SELECT scheduled_at FROM social_selling_posts WHERE account_id = ? AND status != 'failed'"
  ).all(account_id) as Array<{ scheduled_at: string }>;

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
        const candidateDate = publishingDates[index] || new Date(Date.now() + 86400000 * (index + 1));
        const scheduledDate = isNaN(candidateDate.getTime())
          ? new Date(Date.now() + 86400000 * (index + 1))
          : candidateDate;
        const scheduledIso = scheduledDate.toISOString();

        const metricsJson = postItem.original_metrics ? JSON.stringify(postItem.original_metrics) : null;
        const safeMediaUrl =
          postItem.media_url && typeof postItem.media_url === "string" && !postItem.media_url.startsWith("data:")
            ? postItem.media_url
            : null;

        // Seguridad estricta: forzar siempre account_id autorizado, ignorando cualquier postItem.account_id no verificado
        insertStmt.run(
          id,
          (session.user as any)?.id || null,
          account_id,
          topic || postItem.topic || null,
          postItem.content.trim(),
          postItem.image_prompt || null,
          safeMediaUrl,
          safeMediaUrl ? "image" : "none",
          postItem.original_post_url || null,
          postItem.original_author || null,
          postItem.original_content || null,
          metricsJson,
          scheduledIso
        );

        createdPosts.push({
          id,
          account_id,
          scheduled_at: scheduledIso,
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
