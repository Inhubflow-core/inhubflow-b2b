import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { unipile } from "@/lib/unipile/client";

export interface PublishResult {
  id: string;
  status: "published" | "failed" | "skipped";
  post_urn?: string;
  error?: string;
}

/**
 * Publica un post individual de Social Selling en LinkedIn a través de Unipile.
 * Realiza reclamación atómica para evitar ejecuciones concurrentes y gestiona
 * la subida de imágenes y el guardado del URN de LinkedIn.
 */
export async function publishSocialPost(
  db: Database.Database,
  post: any
): Promise<PublishResult> {
  if (!unipile.isConfigured()) {
    const errorMsg = "Unipile no está configurado en el servidor";
    return { id: post.id, status: "failed", error: errorMsg };
  }

  // 1. Reclamación atómica: previene ejecuciones duplicadas en workers concurrentes
  const claimResult = db
    .prepare(
      "UPDATE social_selling_posts SET status = 'publishing' WHERE id = ? AND status IN ('scheduled', 'failed')"
    )
    .run(post.id);

  if (claimResult.changes === 0) {
    return {
      id: post.id,
      status: "skipped",
      error: "La publicación ya está en proceso de envío o ya fue publicada",
    };
  }

  // 2. Obtener y validar cuenta de LinkedIn en Unipile
  const account = db
    .prepare("SELECT unipile_account_id FROM accounts WHERE id = ?")
    .get(post.account_id) as { unipile_account_id?: string } | undefined;
  const unipileAccountId = account?.unipile_account_id;

  if (!unipileAccountId) {
    const errorMsg = "La cuenta emisora no tiene una sesión activa de LinkedIn en Unipile";
    db.prepare("UPDATE social_selling_posts SET status = 'failed', error_message = ? WHERE id = ?")
      .run(errorMsg, post.id);
    return { id: post.id, status: "failed", error: errorMsg };
  }

  try {
    // 3. Preparar adjuntos si el post incluye imagen
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
        throw new Error(
          `El archivo de imagen adjunto (${filename}) no se encuentra en el servidor. Publicación abortada para no enviar un post incompleto.`
        );
      }

      const buffer = fs.readFileSync(targetPath);
      const ext = path.extname(filename).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      attachments = [{ file: buffer, filename, mime_type: mime }];
    }

    // 4. Publicar en LinkedIn mediante Unipile
    const publishRes = await unipile.createPost({
      account_id: unipileAccountId,
      text: post.content,
      attachments,
    });

    const postUrn = (publishRes.id || publishRes.post_id || "published") as string;

    // 5. Marcar como publicado exitosamente con fecha y URN
    db.prepare(`
      UPDATE social_selling_posts
      SET status = 'published',
          linkedin_post_urn = ?,
          published_at = datetime('now'),
          error_message = NULL
      WHERE id = ?
    `).run(postUrn, post.id);

    return { id: post.id, status: "published", post_urn: postUrn };
  } catch (pubErr) {
    const errorMsg = pubErr instanceof Error ? pubErr.message : String(pubErr);
    console.error(`[social-selling/publisher] Error publicando post ${post.id}:`, pubErr);

    db.prepare(`
      UPDATE social_selling_posts
      SET status = 'failed',
          error_message = ?
      WHERE id = ?
    `).run(errorMsg, post.id);

    return { id: post.id, status: "failed", error: errorMsg };
  }
}

/**
 * Busca publicaciones en estado 'scheduled' cuya fecha/hora programada ya venció
 * (scheduled_at <= datetime('now')) y las publica automáticamente.
 */
export async function publishDueScheduledPosts(
  db: Database.Database,
  limit = 5,
  accountIdsFilter?: string[]
): Promise<PublishResult[]> {
  let query = `
    SELECT * FROM social_selling_posts
    WHERE status = 'scheduled'
      AND scheduled_at <= datetime('now')
  `;
  const params: any[] = [];

  if (accountIdsFilter && accountIdsFilter.length > 0) {
    const placeholders = accountIdsFilter.map(() => "?").join(",");
    query += ` AND account_id IN (${placeholders})`;
    params.push(...accountIdsFilter);
  }

  query += ` ORDER BY scheduled_at ASC LIMIT ?`;
  params.push(limit);

  const duePosts = db.prepare(query).all(...params) as any[];

  if (duePosts.length === 0) {
    return [];
  }

  const results: PublishResult[] = [];
  for (const post of duePosts) {
    const res = await publishSocialPost(db, post);
    results.push(res);
  }

  return results;
}
