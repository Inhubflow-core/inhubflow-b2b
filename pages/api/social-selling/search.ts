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

    let targetAccountId = requestedAccountId;
    if (!targetAccountId) {
      const firstAcc = db.prepare("SELECT id FROM accounts WHERE unipile_account_id IS NOT NULL LIMIT 1").get() as any;
      targetAccountId = firstAcc?.id;
    }

    if (!targetAccountId) {
      return res.status(400).json({ error: "No hay cuenta de LinkedIn conectada a Unipile para realizar la búsqueda" });
    }

    const resolved = await resolveUnipileAccount(db, targetAccountId);

    const cleanTopic = topic.trim();
    // Búsqueda profunda en LinkedIn mediante Unipile con paginación
    const searchParams = {
      account_id: resolved.unipileAccountId,
      api: "classic" as const,
      category: "posts" as const,
      limit: 25,
      keywords: cleanTopic,
    };

    const rawItems: UnipileSearchPost[] = [];

    // Página 1
    const p1 = await unipile.searchLinkedIn(searchParams as any);
    const p1Items = (p1.items || []).filter(
      (item): item is UnipileSearchPost =>
        Boolean(item && typeof item === "object" && (item as { type?: string }).type === "POST")
    );
    rawItems.push(...p1Items);

    // Página 2 (para profundizar y encontrar posts con verdadero engagement)
    if (p1.cursor) {
      try {
        const p2 = await unipile.searchLinkedIn({
          ...searchParams,
          cursor: p1.cursor,
        } as any);
        const p2Items = (p2.items || []).filter(
          (item): item is UnipileSearchPost =>
            Boolean(item && typeof item === "object" && (item as { type?: string }).type === "POST")
        );
        rawItems.push(...p2Items);

        // Página 3 si aún hay cursor y queremos un pool representativo (~75 posts)
        if (p2.cursor && rawItems.length < 50) {
          const p3 = await unipile.searchLinkedIn({
            ...searchParams,
            cursor: p2.cursor,
          } as any);
          const p3Items = (p3.items || []).filter(
            (item): item is UnipileSearchPost =>
              Boolean(item && typeof item === "object" && (item as { type?: string }).type === "POST")
          );
          rawItems.push(...p3Items);
        }
      } catch (pageErr) {
        console.warn("[api/social-selling/search] Warning fetching subsequent pages:", pageErr);
      }
    }

    // Deduplicación por ID o URL
    const seenIds = new Set<string>();
    const uniqueRawItems: UnipileSearchPost[] = [];
    for (const item of rawItems) {
      const id = (item as any).id || (item as any).social_id || (item as any).url || (item as any).share_url;
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      uniqueRawItems.push(item);
    }

    // Mapear y calcular engagement score priorizando conversación y debate real
    const formattedPosts = uniqueRawItems
      .filter((item) => {
        const text = (item as any).text || (item as any).content || "";
        return text.trim().length >= 25; // Descartar publicaciones vacías o spam de un solo hashtag
      })
      .map((item) => {
        const likes = Number((item as any).reaction_counter ?? (item as any).likes_count ?? (item as any).reactions_count ?? 0);
        const comments = Number((item as any).comment_counter ?? (item as any).comments_count ?? 0);
        const shares = Number((item as any).repost_counter ?? (item as any).shares_count ?? 0);

        // En LinkedIn los comentarios y reposts representan viralidad real y debate profundo
        const engagementScore = (likes * 1) + (comments * 6) + (shares * 4);

        const authorName = (item as any).author?.name || (item as any).author?.username || (item as any).actor?.name || "Líder de Industria";
        const authorHeadline = (item as any).author?.headline || (item as any).author?.occupation || "";
        const authorAvatar = (item as any).author?.profile_picture_url || (item as any).author?.avatar || null;
        const text = (item as any).text || (item as any).content || "";
        const mediaUrl = (item as any).attachments?.[0]?.url || (item as any).image_url || (item as any).media?.[0]?.url || null;
        const rawPostUrl = (item as any).url || (item as any).share_url || (item as any).post_url || null;
        const postId = (item as any).id || (item as any).social_id || String(Math.random());
        let postUrl = rawPostUrl && typeof rawPostUrl === "string" && rawPostUrl.startsWith("http")
          ? rawPostUrl
          : null;

        if (!postUrl) {
          const rawId = (item as any).social_id || (item as any).id;
          if (rawId) {
            postUrl = `https://www.linkedin.com/feed/update/${rawId}`;
          }
        }

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

    // Ordenar de mayor a menor engagement (desempates por comentarios y luego likes)
    formattedPosts.sort((a, b) => {
      if (b.engagement_score !== a.engagement_score) {
        return b.engagement_score - a.engagement_score;
      }
      if (b.comments_count !== a.comments_count) {
        return b.comments_count - a.comments_count;
      }
      return b.likes_count - a.likes_count;
    });

    // Filtros de calidad para evitar "posts muertos" (0 comentarios y < 4 likes)
    // Tier 1: Publicaciones con debate real (al menos 1 comentario) o alto volumen de reacciones (>=10 likes) o reposts (>=2)
    const tier1 = formattedPosts.filter((p) => p.comments_count >= 1 || p.likes_count >= 10 || p.shares_count >= 2);
    // Tier 2: Publicaciones con tracción moderada (al menos 4 likes o 1 share)
    const tier2 = formattedPosts.filter((p) => !tier1.includes(p) && (p.likes_count >= 4 || p.shares_count >= 1));

    let top12 = [...tier1];
    if (top12.length < 12) {
      const needed = 12 - top12.length;
      top12.push(...tier2.slice(0, needed));
    }

    // Si la búsqueda es tan de nicho que no hay suficientes posts en Tier 1 ni Tier 2, usar lo mejor disponible
    if (top12.length === 0) {
      top12 = formattedPosts.slice(0, 12);
    } else {
      top12 = top12.slice(0, 12);
    }

    return res.status(200).json({
      topic: cleanTopic,
      total_found: formattedPosts.length,
      scanned_pool: rawItems.length,
      posts: top12,
    });
  } catch (error) {
    console.error("[api/social-selling/search] Error searching viral posts:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Error al buscar publicaciones en LinkedIn",
    });
  }
}
