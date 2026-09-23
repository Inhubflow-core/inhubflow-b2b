import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import { unipile } from "@/lib/unipile/client";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import type { UnipileSearchPost } from "@/lib/unipile/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const db = getDb();
  const topic = (req.method === "POST" ? req.body.topic : req.query.topic) as string | undefined;
  const requestedAccountId = (req.method === "POST" ? req.body.account_id : req.query.account_id) as string | undefined;

  if (!topic || !topic.trim()) {
    return res.status(400).json({ error: "El tema o palabra clave es obligatorio" });
  }

  try {
    if (!unipile.isConfigured()) {
      return res.status(500).json({ error: "Unipile no está configurado en el servidor" });
    }

    const resolved = await resolveUnipileAccount(db, requestedAccountId);
    if (!resolved.unipileAccountId) {
      return res.status(400).json({ error: "No hay cuenta de LinkedIn conectada a Unipile para realizar la búsqueda" });
    }

    const cleanTopic = topic.trim();
    // Búsqueda en LinkedIn mediante Unipile
    const searchParams = {
      account_id: resolved.unipileAccountId,
      api: "classic" as const,
      category: "posts" as const,
      limit: 25,
      keywords: cleanTopic,
    };

    const response = await unipile.searchLinkedIn(searchParams as any);
    const rawItems = (response.items || []).filter(
      (item): item is UnipileSearchPost =>
        Boolean(item && typeof item === "object" && (item as { type?: string }).type === "POST")
    );

    // Mapear y calcular engagement score para ordenar los más virales
    const formattedPosts = rawItems.map((item) => {
      const likes = Number((item as any).reaction_counter ?? (item as any).likes_count ?? (item as any).reactions_count ?? 0);
      const comments = Number((item as any).comment_counter ?? (item as any).comments_count ?? 0);
      const shares = Number((item as any).repost_counter ?? (item as any).shares_count ?? 0);
      const engagementScore = likes * 2 + comments * 5 + shares * 10;

      const authorName = (item as any).author?.name || (item as any).author?.username || (item as any).actor?.name || "Líder de Industria";
      const authorHeadline = (item as any).author?.headline || (item as any).author?.occupation || "";
      const authorAvatar = (item as any).author?.profile_picture_url || (item as any).author?.avatar || null;
      const text = (item as any).text || (item as any).content || "";
      const postUrl = (item as any).url || (item as any).share_url || (item as any).post_url || null;
      const mediaUrl = (item as any).attachments?.[0]?.url || (item as any).image_url || (item as any).media?.[0]?.url || null;
      const postId = (item as any).id || (item as any).social_id || String(Math.random());

      return {
        id: postId,
        author_name: authorName,
        author_headline: authorHeadline,
        author_avatar: authorAvatar,
        text,
        likes_count: likes,
        comments_count: comments,
        shares_count: shares,
        engagement_score: engagementScore,
        media_url: mediaUrl,
        post_url: postUrl,
        date: (item as any).date || (item as any).created_at || (item as any).parsed_datetime || null,
      };
    });

    // Ordenar de mayor a menor engagement y tomar los top 12
    formattedPosts.sort((a, b) => b.engagement_score - a.engagement_score);
    const top12 = formattedPosts.slice(0, 12);

    return res.status(200).json({
      topic: cleanTopic,
      total_found: formattedPosts.length,
      posts: top12,
    });
  } catch (error) {
    console.error("[api/social-selling/search] Error searching viral posts:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Error al buscar publicaciones en LinkedIn",
    });
  }
}
