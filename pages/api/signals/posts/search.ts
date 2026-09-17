import type { NextApiRequest, NextApiResponse } from "next";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import { unipile } from "@/lib/unipile/client";
import type { UnipileSearchPost } from "@/lib/unipile/types";

export interface DiscoveredPostItem {
  id: string;
  shareUrl: string;
  text: string;
  date: string | null;
  parsedDatetime: string | null;
  reactionCount: number;
  commentCount: number;
  repostCount: number;
  author: {
    id: string | null;
    name: string;
    headline: string | null;
    profilePictureUrl: string | null;
    publicIdentifier: string | null;
    isCompany: boolean;
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const {
    account_id,
    keywords = "",
    competitor = "",
    date_posted = "past_month",
    sort_by = "engagement",
    limit = 20,
  } = req.body || {};

  const accountId = typeof account_id === "string" ? account_id.trim() : "";
  if (!accountId) return res.status(400).json({ error: "account_id es requerido para buscar en LinkedIn" });

  const queryParts: string[] = [];
  if (competitor && typeof competitor === "string" && competitor.trim()) {
    queryParts.push(competitor.trim());
  }
  if (keywords && typeof keywords === "string" && keywords.trim()) {
    queryParts.push(keywords.trim());
  }

  const queryString = queryParts.join(" ").trim();
  if (!queryString) {
    return res.status(400).json({ error: "Ingresa al menos una palabra clave o el nombre de un competidor/marca" });
  }

  const db = getDb();
  if (!canAccessLinkedInAccount(db, actor, accountId)) {
    return res.status(404).json({ error: "Cuenta no encontrada o no autorizada" });
  }

  try {
    if (!unipile.isConfigured()) {
      return res.status(502).json({ error: "El motor Unipile no está configurado" });
    }

    const resolved = await resolveUnipileAccount(db, accountId, unipile);
    const numericLimit = Math.min(50, Math.max(5, Number(limit) || 20));

    // Mapear fecha según Unipile (past_24h, past_week, past_month)
    let unipileDatePosted: "past_24h" | "past_week" | "past_month" | undefined = "past_month";
    if (date_posted === "past_24h" || date_posted === "today") {
      unipileDatePosted = "past_24h";
    } else if (date_posted === "past_week" || date_posted === "week") {
      unipileDatePosted = "past_week";
    } else if (date_posted === "past_month" || date_posted === "month") {
      unipileDatePosted = "past_month";
    } else {
      unipileDatePosted = undefined;
    }

    const searchParams: Record<string, unknown> = {
      account_id: resolved.unipileAccountId,
      api: "classic",
      category: "posts",
      limit: numericLimit,
      keywords: queryString,
      ...(unipileDatePosted ? { date_posted: unipileDatePosted } : {}),
      ...(sort_by === "date" ? { sort_by: "date" } : {}),
    };

    const response = await unipile.searchLinkedIn(searchParams as any);

    const rawPosts = (response.items || []).filter(
      (item): item is UnipileSearchPost =>
        Boolean(item && typeof item === "object" && (item as { type?: string }).type === "POST")
    );

    const formattedPosts: DiscoveredPostItem[] = rawPosts.map((post) => ({
      id: post.id || post.social_id || "",
      shareUrl: post.share_url || `https://www.linkedin.com/feed/update/${post.social_id || post.id}`,
      text: post.text || "",
      date: post.date || null,
      parsedDatetime: post.parsed_datetime || null,
      reactionCount: Number(post.reaction_counter) || 0,
      commentCount: Number(post.comment_counter) || 0,
      repostCount: Number(post.repost_counter) || 0,
      author: {
        id: post.author?.id || null,
        name: post.author?.name || "Autor en LinkedIn",
        headline: post.author?.headline || null,
        profilePictureUrl: post.author?.profile_picture_url || null,
        publicIdentifier: post.author?.public_identifier || null,
        isCompany: Boolean(post.author?.is_company),
      },
    }));

    // Si ordenamos por viralidad / engagement, ordenamos por (reacciones + comentarios) desc
    if (sort_by === "engagement") {
      formattedPosts.sort((a, b) => (b.reactionCount + b.commentCount * 2) - (a.reactionCount + a.commentCount * 2));
    }

    return res.status(200).json({
      success: true,
      query: queryString,
      count: formattedPosts.length,
      items: formattedPosts,
    });
  } catch (error) {
    console.error("[api/signals/posts/search] Error searching posts:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Error al buscar publicaciones en LinkedIn vía Unipile",
    });
  }
}
