import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";
import {
  getAuthorizedAccountIds,
  isAccountAuthorized,
  getAuthorizedPost,
} from "@/lib/social-selling/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const db = getDb();
  const currentUser = session.user as any;
  const allowedAccountIds = getAuthorizedAccountIds(db, currentUser);

  if (allowedAccountIds.length === 0) {
    return res.status(200).json({ posts: [] });
  }

  // GET: Listar publicaciones para el calendario (con aislamiento multi-tenant estricto)
  if (req.method === "GET") {
    try {
      const { account_id, status } = req.query;

      let query = "SELECT * FROM social_selling_posts WHERE 1=1";
      const params: any[] = [];

      if (account_id && typeof account_id === "string") {
        if (!isAccountAuthorized(db, currentUser, account_id)) {
          return res.status(403).json({ error: "No tienes autorización para acceder a esta cuenta" });
        }
        query += " AND account_id = ?";
        params.push(account_id);
      } else {
        // Filtrar exclusivamente por las cuentas autorizadas del usuario
        const placeholders = allowedAccountIds.map(() => "?").join(",");
        query += ` AND account_id IN (${placeholders})`;
        params.push(...allowedAccountIds);
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

      // Validar autorización de la cuenta emisora
      if (!isAccountAuthorized(db, currentUser, targetAccountId)) {
        return res.status(403).json({ error: "No tienes autorización para programar en esta cuenta" });
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
        currentUser?.id || null,
        targetAccountId,
        topic || null,
        content.trim(),
        image_prompt || null,
        media_url || null,
        media_url ? "image" : (media_type || "none"),
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

  // PUT: Actualizar un post existente (con soporte explícito de borrado de campos opcionales)
  if (req.method === "PUT") {
    try {
      const { id, content, scheduled_at, status, image_prompt, media_url, media_type, account_id } = req.body;
      if (!id) {
        return res.status(400).json({ error: "id es obligatorio" });
      }

      // Buscar exclusivamente entre posts autorizados para el usuario
      const existing = getAuthorizedPost(db, currentUser, id);
      if (!existing) {
        return res.status(404).json({ error: "Publicación no encontrada o no autorizada" });
      }

      // Si se intenta transferir a otra cuenta, validar que la cuenta de destino esté autorizada
      if (account_id && account_id !== existing.account_id) {
        if (!isAccountAuthorized(db, currentUser, account_id)) {
          return res.status(403).json({ error: "No tienes autorización para mover a la cuenta indicada" });
        }
      }

      // Si el post ya fue publicado, impedir reprogramar la fecha histórica
      if (existing.status === "published" && scheduled_at && scheduled_at !== existing.scheduled_at) {
        return res.status(400).json({ error: "No se puede reprogramar una publicación que ya fue enviada a LinkedIn" });
      }

      // Distinguir entre valor no enviado (undefined) y valor intencionalmente borrado (null)
      const nextContent = content !== undefined ? content : existing.content;
      const nextScheduledAt = scheduled_at !== undefined ? scheduled_at : existing.scheduled_at;
      const nextStatus = status !== undefined ? status : existing.status;
      const nextImagePrompt = image_prompt !== undefined ? image_prompt : existing.image_prompt;
      const nextMediaUrl = media_url !== undefined ? media_url : existing.media_url;
      const nextMediaType = media_type !== undefined ? media_type : (nextMediaUrl ? "image" : "none");
      const nextAccountId = account_id !== undefined ? account_id : existing.account_id;

      db.prepare(`
        UPDATE social_selling_posts
        SET content = ?,
            scheduled_at = ?,
            status = ?,
            image_prompt = ?,
            media_url = ?,
            media_type = ?,
            account_id = ?
        WHERE id = ?
      `).run(
        nextContent,
        nextScheduledAt,
        nextStatus,
        nextImagePrompt,
        nextMediaUrl,
        nextMediaType,
        nextAccountId,
        id
      );

      const updated = db.prepare("SELECT * FROM social_selling_posts WHERE id = ?").get(id);
      return res.status(200).json({ post: updated });
    } catch (error) {
      console.error("[api/social-selling/posts] PUT error:", error);
      return res.status(500).json({ error: "Error actualizando publicación" });
    }
  }

  // DELETE: Eliminar un post programado (con autorización de pertenencia)
  if (req.method === "DELETE") {
    try {
      const id = (req.query.id as string) || req.body?.id;
      if (!id) {
        return res.status(400).json({ error: "id es obligatorio" });
      }

      const existing = getAuthorizedPost(db, currentUser, id);
      if (!existing) {
        return res.status(404).json({ error: "Publicación no encontrada o no autorizada" });
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
