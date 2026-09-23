import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import fs from "node:fs";
import path from "node:path";
import { unipile } from "@/lib/unipile/client";
import { getAuthorizedAccountIds, getAuthorizedPost } from "@/lib/social-selling/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const db = getDb();
  if (!unipile.isConfigured()) {
    return res.status(500).json({ error: "Unipile no está configurado en el servidor" });
  }

  const currentUser = session.user as any;
  const allowedAccountIds = getAuthorizedAccountIds(db, currentUser);

  if (allowedAccountIds.length === 0) {
    return res.status(403).json({ error: "No tienes cuentas de LinkedIn autorizadas" });
  }

  const { post_id } = req.body;

  try {
    let postsToPublish: any[] = [];

    if (post_id) {
      // 1. Publicación manual por ID: comprobar autorización estricta de pertenencia
      const post = getAuthorizedPost(db, currentUser, post_id);
      if (!post) {
        return res.status(404).json({ error: "Publicación no encontrada o no autorizada" });
      }

      if (post.status === "published") {
        return res.status(400).json({ error: "Esta publicación ya ha sido enviada a LinkedIn anteriormente" });
      }

      if (post.status === "publishing") {
        return res.status(400).json({ error: "La publicación ya se encuentra en proceso de envío" });
      }

      postsToPublish = [post];
    } else {
      // 2. Procesamiento automático de posts vencidos: limitar estrictamente a las cuentas del usuario
      const placeholders = allowedAccountIds.map(() => "?").join(",");
      postsToPublish = db
        .prepare(`
          SELECT * FROM social_selling_posts
          WHERE status = 'scheduled'
            AND scheduled_at <= datetime('now')
            AND account_id IN (${placeholders})
          ORDER BY scheduled_at ASC
          LIMIT 5
        `)
        .all(...allowedAccountIds) as any[];
    }

    if (postsToPublish.length === 0) {
      return res.status(200).json({ message: "No hay posts pendientes para publicar", published: [] });
    }

    const results: any[] = [];

    for (const post of postsToPublish) {
      // Reclamación atómica y condicional: previene doble ejecución por solicitudes concurrentes
      const claimResult = db
        .prepare("UPDATE social_selling_posts SET status = 'publishing' WHERE id = ? AND status IN ('scheduled', 'failed')")
        .run(post.id);

      if (claimResult.changes === 0) {
        results.push({
          id: post.id,
          status: "skipped",
          error: "La publicación ya está en proceso o ya fue publicada",
        });
        continue;
      }

      // Obtener y validar cuenta de LinkedIn en Unipile
      const account = db
        .prepare("SELECT unipile_account_id FROM accounts WHERE id = ?")
        .get(post.account_id) as { unipile_account_id?: string } | undefined;
      const unipileAccountId = account?.unipile_account_id;

      if (!unipileAccountId) {
        const errorMsg = "La cuenta emisora no tiene una sesión activa de LinkedIn en Unipile";
        db.prepare("UPDATE social_selling_posts SET status = 'failed', error_message = ? WHERE id = ?")
          .run(errorMsg, post.id);
        results.push({ id: post.id, status: "failed", error: errorMsg });
        continue;
      }

      try {
        // Preparar adjuntos si el post tiene imagen
        let attachments: Array<{ file: Buffer; filename: string; mime_type: string }> | undefined;

        if (post.media_url) {
          let filename = "";
          if (post.media_url.includes("file=")) {
            filename = post.media_url.split("file=")[1]?.split("&")[0] || "";
          } else {
            filename = path.basename(post.media_url.split("?")[0]);
          }

          if (!filename) {
            throw new Error("La URL de la imagen adjunta no es válida o está malformada");
          }

          const primaryPath = path.join(process.cwd(), "public", "uploads", "social-posts", filename);
          const dataPath = path.join("/data", "uploads", "social-posts", filename);
          const targetPath = fs.existsSync(primaryPath) ? primaryPath : fs.existsSync(dataPath) ? dataPath : "";

          if (!targetPath) {
            // Protección estricta: NO publicar parcialmente sin imagen si la publicación la requiere
            throw new Error(`El archivo de imagen adjunto (${filename}) no se encuentra en el servidor. Publicación abortada para no enviar un post incompleto.`);
          }

          const buffer = fs.readFileSync(targetPath);
          const ext = path.extname(filename).toLowerCase();
          const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
          attachments = [{ file: buffer, filename, mime_type: mime }];
        }

        // Publicar en LinkedIn a través de Unipile
        const publishRes = await unipile.createPost({
          account_id: unipileAccountId,
          text: post.content,
          attachments,
        });

        const postUrn = (publishRes.id || publishRes.post_id || "published") as string;

        db.prepare(`
          UPDATE social_selling_posts
          SET status = 'published',
              linkedin_post_urn = ?,
              published_at = datetime('now'),
              error_message = NULL
          WHERE id = ?
        `).run(postUrn, post.id);

        results.push({ id: post.id, status: "published", post_urn: postUrn });
      } catch (pubErr) {
        const errorMsg = pubErr instanceof Error ? pubErr.message : String(pubErr);
        console.error(`[api/social-selling/publish] Error publicando post ${post.id}:`, pubErr);

        db.prepare(`
          UPDATE social_selling_posts
          SET status = 'failed',
              error_message = ?
          WHERE id = ?
        `).run(errorMsg, post.id);

        results.push({ id: post.id, status: "failed", error: errorMsg });

        if (post_id) {
          // Si fue una petición individual manual, devolver error HTTP para feedback instantáneo
          return res.status(400).json({ error: errorMsg, post_id: post.id });
        }
      }
    }

    return res.status(200).json({
      success: true,
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error("[api/social-selling/publish] Global error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Error publicando posts",
    });
  }
}
