import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import { unipile } from "@/lib/unipile/client";

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
    return res.status(500).json({ error: "Unipile no está configurado" });
  }

  const { post_id } = req.body;

  try {
    // Si se pasa post_id, publica ese post específico de inmediato
    const postsToPublish = post_id
      ? db.prepare("SELECT * FROM social_selling_posts WHERE id = ?").all(post_id) as any[]
      : db.prepare(`
          SELECT * FROM social_selling_posts
          WHERE status = 'scheduled' AND scheduled_at <= datetime('now')
          ORDER BY scheduled_at ASC
          LIMIT 5
        `).all() as any[];

    if (postsToPublish.length === 0) {
      return res.status(200).json({ message: "No hay posts pendientes para publicar", published: [] });
    }

    const results: any[] = [];

    for (const post of postsToPublish) {
      // Marcar como en proceso
      db.prepare("UPDATE social_selling_posts SET status = 'publishing' WHERE id = ?").run(post.id);

      // Obtener cuenta de LinkedIn en Unipile
      const account = db.prepare("SELECT unipile_account_id FROM accounts WHERE id = ?").get(post.account_id) as { unipile_account_id?: string } | undefined;
      const unipileAccountId = account?.unipile_account_id;

      if (!unipileAccountId) {
        db.prepare("UPDATE social_selling_posts SET status = 'failed', error_message = ? WHERE id = ?")
          .run("Cuenta no conectada a Unipile", post.id);
        results.push({ id: post.id, status: "failed", error: "Cuenta no conectada a Unipile" });
        continue;
      }

      try {
        const publishRes = await unipile.createPost({
          account_id: unipileAccountId,
          text: post.content,
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
