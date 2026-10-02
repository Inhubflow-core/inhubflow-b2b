import type { NextApiRequest, NextApiResponse } from "next";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import { unipile } from "@/lib/unipile/client";
import type { UnipileSearchPost } from "@/lib/unipile/types";
import { expandLocationCriteria, expandTitleCriteria } from "@/lib/signals/scanners/scoring";

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
  relevanceScore?: number;
  isIcpMatch?: boolean;
  relevanceReasons?: string[];
}

function quoteTerm(t: string): string {
  const trimmed = t.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed;
  if (trimmed.includes(" ") || trimmed.includes("-")) {
    return `"${trimmed.replace(/"/g, "")}"`;
  }
  return trimmed;
}

function buildSearchQueries(keywords: string, competitor?: string, country?: string): string[] {
  const comp = (competitor || "").trim();
  const splitTerms = (keywords || "")
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  let formattedKeywords = splitTerms.map(quoteTerm).join(" OR ") || quoteTerm(keywords);
  const baseQuery = comp && formattedKeywords ? `${quoteTerm(comp)} ${formattedKeywords}` : (formattedKeywords || quoteTerm(comp));

  const queries: string[] = [];
  const cNorm = (country || "").toLowerCase().trim();
  const hasCountry = Boolean(cNorm && cNorm !== "global / todos" && cNorm !== "global" && cNorm !== "todos");

  // 1. Si se especificó un país y la consulta no lo incluye, probar primero contextualizada con el país
  if (hasCountry && !keywords.toLowerCase().includes(cNorm)) {
    queries.push(`${baseQuery} ${country}`);
  }

  // 2. Consulta estándar (con frases exactas entre comillas)
  if (baseQuery) {
    queries.push(baseQuery);
  }

  // 3. Fallback: primer término individual si había múltiples
  if (splitTerms.length > 1) {
    const singleTerm = comp ? `${quoteTerm(comp)} ${quoteTerm(splitTerms[0])}` : quoteTerm(splitTerms[0]);
    queries.push(singleTerm);
  }

  // 4. Fallback: sólo el competidor o marca si existe
  if (comp) {
    queries.push(quoteTerm(comp));
  }

  return [...new Set(queries.filter(Boolean))];
}

function scorePost(
  post: UnipileSearchPost,
  icp: { title?: string; country?: string; company?: string; keywords: string[] }
): { score: number; isIcpMatch: boolean; reasons: string[] } {
  let score = 40;
  const reasons: string[] = [];
  let isIcpMatch = false;
  const text = (post.text || "").toLowerCase();
  const headline = (post.author?.headline || "").toLowerCase();

  // 1. Coincidencia de palabras clave en el texto (universal para cualquier industria o servicio)
  for (const kw of icp.keywords) {
    const clean = kw.toLowerCase().replace(/"/g, "").trim();
    if (!clean) continue;
    if (text.includes(clean)) {
      score += 30;
      reasons.push(`Menciona "${clean}"`);
      break;
    }
  }

  // 2. Coincidencia con Cargo / Rol del ICP en el headline del autor (universal con expandTitleCriteria)
  if (icp.title) {
    const titleTokens = icp.title
      .toLowerCase()
      .split(/[,;\/]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const expanded = expandTitleCriteria(titleTokens);
    const match = Array.from(expanded).find(
      (tok) => tok.length >= 3 && headline.includes(tok.toLowerCase())
    );
    if (match) {
      score += 20;
      isIcpMatch = true;
      reasons.push(`Autor: ${match}`);
    }
  }

  // 3. Coincidencia con País / Territorio (universal con expandLocationCriteria para cualquier país del mundo)
  if (icp.country && !/global/i.test(icp.country)) {
    const expandedLocs = expandLocationCriteria([icp.country]);
    const matchLoc = Array.from(expandedLocs).find(
      (loc) => loc.length >= 3 && (text.includes(loc.toLowerCase()) || headline.includes(loc.toLowerCase()))
    );
    if (matchLoc) {
      score += 10;
      reasons.push(`Ubicación: ${icp.country}`);
    }
  }

  // 4. Coincidencia con Industria / Empresa (universal para cualquier nicho o sector)
  if (icp.company) {
    const compTokens = icp.company
      .toLowerCase()
      .split(/[,;\/]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const matchComp = compTokens.find(
      (tok) => tok.length >= 3 && (text.includes(tok) || headline.includes(tok))
    );
    if (matchComp) {
      score += 10;
      reasons.push(`Sector: ${matchComp}`);
    }
  }

  return { score: Math.min(100, score), isIcpMatch, reasons };
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
    icp_title = "",
    icp_country = "",
    icp_company = "",
    icp_city = "",
  } = req.body || {};

  const accountId = typeof account_id === "string" ? account_id.trim() : "";
  if (!accountId) return res.status(400).json({ error: "account_id es requerido para buscar en LinkedIn" });

  const rawKeywords = typeof keywords === "string" ? keywords.trim() : "";
  const rawCompetitor = typeof competitor === "string" ? competitor.trim() : "";
  const rawCountry = typeof icp_country === "string" ? icp_country.trim() : "";
  const rawTitle = typeof icp_title === "string" ? icp_title.trim() : "";
  const rawCompany = typeof icp_company === "string" ? icp_company.trim() : "";

  if (!rawKeywords && !rawCompetitor) {
    return res.status(400).json({ error: "Ingresa al menos una palabra clave o el nombre de un competidor/marca" });
  }

  const db = getDb();
  if (!canAccessLinkedInAccount(db, actor, accountId)) {
    return res.status(404).json({ error: "Cuenta no encontrada o no autorizada" });
  }

  try {
    if (!unipile.isConfigured()) {
      return res.status(502).json({ error: "El servicio de búsqueda no está configurado" });
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

    const candidateQueries = buildSearchQueries(rawKeywords, rawCompetitor, rawCountry);

    const executeSearch = async (q: string, dPosted?: "past_24h" | "past_week" | "past_month") => {
      const searchParams: Record<string, unknown> = {
        account_id: resolved.unipileAccountId,
        api: "classic",
        category: "posts",
        limit: numericLimit,
        keywords: q,
        ...(dPosted ? { date_posted: dPosted } : {}),
        ...(sort_by === "date" ? { sort_by: "date" } : {}),
      };
      const response = await unipile.searchLinkedIn(searchParams as any);
      return (response.items || []).filter(
        (item): item is UnipileSearchPost =>
          Boolean(item && typeof item === "object" && (item as { type?: string }).type === "POST")
      );
    };

    let rawPosts: UnipileSearchPost[] = [];
    let executedQuery = candidateQueries[0] || rawKeywords;

    for (const q of candidateQueries) {
      executedQuery = q;
      rawPosts = await executeSearch(q, unipileDatePosted).catch(() => []);
      if (rawPosts.length > 0) break;

      // Si no hubo resultados y había filtro de fecha, probar sin filtro de fecha
      if (unipileDatePosted) {
        rawPosts = await executeSearch(q, undefined).catch(() => []);
        if (rawPosts.length > 0) break;
      }
    }

    const splitKwList = rawKeywords
      .split(/[,;\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const formattedPosts: DiscoveredPostItem[] = rawPosts.map((post) => {
      const { score, isIcpMatch, reasons } = scorePost(post, {
        title: rawTitle,
        country: rawCountry,
        company: rawCompany,
        keywords: splitKwList.length > 0 ? splitKwList : [rawKeywords],
      });

      return {
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
        relevanceScore: score,
        isIcpMatch,
        relevanceReasons: reasons,
      };
    });

    // Ordenar por relevancia e interacción
    if (sort_by === "engagement") {
      formattedPosts.sort((a, b) => {
        const relDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
        if (relDiff !== 0 && Math.abs(relDiff) >= 15) return relDiff;
        return (b.reactionCount + b.commentCount * 2) - (a.reactionCount + a.commentCount * 2);
      });
    } else if (sort_by === "date") {
      // Priorizar alta relevancia primero, luego orden por fecha
      formattedPosts.sort((a, b) => {
        const relDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
        if (relDiff !== 0 && Math.abs(relDiff) >= 20) return relDiff;
        return 0; // mantener orden devuelto por fecha
      });
    }

    return res.status(200).json({
      success: true,
      query: executedQuery,
      count: formattedPosts.length,
      posts: formattedPosts,
      items: formattedPosts,
    });
  } catch (error) {
    console.error("[api/signals/posts/search] Error searching posts:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Error al buscar publicaciones en LinkedIn",
    });
  }
}
