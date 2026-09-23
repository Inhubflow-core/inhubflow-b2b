import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const db = getDb();

  const currentUser = session.user as any;

  // GET: Listar publicaciones para el calendario
  if (req.method === "GET") {
    try {
      const { account_id, status } = req.query;

      let query = "SELECT * FROM social_selling_posts WHERE 1=1";
      const params: any[] = [];

      // Si es un miembro de equipo asignado a una cuenta, solo ve su cuenta
      if (currentUser?.owner_id && currentUser?.assigned_account_id) {
        query += " AND account_id = ?";
        params.push(currentUser.assigned_account_id);
      } else if (account_id && typeof account_id === "string") {
        query += " AND account_id = ?";
        params.push(account_id);
      }

      if (status && typeof status === "string") {
        query += " AND status = ?";
        params.push(status);
      }

      query += " ORDER BY scheduled_at ASC";

      const posts = db.prepare(query).all(...params);
      return res.status(200).json({ posts });
    } catch (error) {
      console.error("[api/social-selling/posts] GET error:", error);
      return res.status(500).json({ error: "Error obteniendo publicaciones" });
    }
  }

  // POST: Crear un nuevo post (individual o borrador)
  if (req.method === "POST") {
    try {
      const {
        account_id,
        content,
        topic,
        scheduled_at,
        image_prompt,
        media_url,
        media_type = "none",
        original_post_url,
        original_author,
        original_content,
        original_metrics,
        status = "scheduled",
      } = req.body;

      const targetAccountId = (currentUser?.owner_id && currentUser?.assigned_account_id)
        ? currentUser.assigned_account_id
        : account_id;

      if (!targetAccountId) {
        return res.status(400).json({ error: "account_id es obligatorio" });
      }

      if (!content || !content.trim()) {
        return res.status(400).json({ error: "El contenido del post es obligatorio" });
      }

      const id = randomUUID();
      const scheduledTime = scheduled_at || new Date(Date.now() + 3600 * 1000 * 24).toISOString();
      const metricsJson = original_metrics ? JSON.stringify(original_metrics) : null;

      db.prepare(`
        INSERT INTO social_selling_posts (
          id, user_id, account_id, topic, content, image_prompt, media_url, media_type,
          original_post_url, original_author, original_content, original_metrics_json,
          scheduled_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        (session.user as any)?.id || null,
        account_id,
        topic || null,
        content.trim(),
        image_prompt || null,
        media_url || null,
        media_type,
        original_post_url || null,
        original_author || null,
        original_content || null,
        metricsJson,
        scheduledTime,
        status
      );

      const created = db.prepare("SELECT * FROM social_selling_posts WHERE id = ?").get(id);
      return res.status(201).json({ post: created });
    } catch (error) {
      console.error("[api/social-selling/posts] POST error:", error);
      return res.status(500).json({ error: "Error creando publicación" });
    }
  }

  // PUT: Actualizar un post existente
  if (req.method === "PUT") {
    try {
      const { id, content, scheduled_at, status, image_prompt, media_url, media_type, account_id } = req.body;
      if (!id) {
        return res.status(400).json({ error: "id es obligatorio" });
      }

      const existing = db.prepare("SELECT * FROM social_selling_posts WHERE id = ?").get(id) as any;
      if (!existing) {
        return res.status(404).json({ error: "Publicación no encontrada" });
      }

      db.prepare(`
        UPDATE social_selling_posts
        SET content = COALESCE(?, content),
            scheduled_at = COALESCE(?, scheduled_at),
            status = COALESCE(?, status),
            image_prompt = COALESCE(?, image_prompt),
            media_url = COALESCE(?, media_url),
            media_type = COALESCE(?, media_type),
            account_id = COALESCE(?, account_id)
        WHERE id = ?
      `).run(
        content ?? null,
        scheduled_at ?? null,
        status ?? null,
        image_prompt ?? null,
        media_url ?? null,
        media_type ?? null,
        account_id ?? null,
        id
      );

      const updated = db.prepare("SELECT * FROM social_selling_posts WHERE id = ?").get(id);
      return res.status(200).json({ post: updated });
    } catch (error) {
      console.error("[api/social-selling/posts] PUT error:", error);
      return res.status(500).json({ error: "Error actualizando publicación" });
    }
  }

  // DELETE: Eliminar un post programado
  if (req.method === "DELETE") {
    try {
      const id = req.query.id as string || req.body.id;
      if (!id) {
        return res.status(400).json({ error: "id es obligatorio" });
      }

      db.prepare("DELETE FROM social_selling_posts WHERE id = ?").run(id);
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("[api/social-selling/posts] DELETE error:", error);
      return res.status(500).json({ error: "Error eliminando publicación" });
    }
  }

  return res.status(405).json({ error: "Método no permitido" });
}
