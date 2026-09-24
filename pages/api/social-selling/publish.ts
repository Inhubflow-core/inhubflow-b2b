import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import { unipile } from "@/lib/unipile/client";
import { getAuthorizedAccountIds, getAuthorizedPost } from "@/lib/social-selling/auth";
import { publishSocialPost, publishDueScheduledPosts } from "@/lib/social-selling/publisher";

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
    if (post_id) {
      // 1. Publicación manual de un post específico
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

      const result = await publishSocialPost(db, post);

      if (result.status === "failed") {
        return res.status(400).json({ error: result.error, post_id: post.id });
      }

      return res.status(200).json({
        success: true,
        result,
      });
    }

    // 2. Procesamiento de posts vencidos autorizados
    const results = await publishDueScheduledPosts(db, 5, allowedAccountIds);

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
