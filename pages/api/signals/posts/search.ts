import type { NextApiRequest, NextApiResponse } from "next";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import { unipile } from "@/lib/unipile/client";
import type { UnipileSearchPost } from "@/lib/unipile/types";
import {
  expandLocationCriteria,
  expandTitleCriteria,
  hasIncompatibleScript,
  hasConflictingCountry,
  getB2bTermVariants,
  getPrimaryCityForCountry,
  isSpanishCountry,
  isPortugueseCountry,
  hasSpanishLanguageIndicators,
  hasPortugueseLanguageIndicators,
} from "@/lib/signals/scanners/scoring";

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

  const cNorm = (country || "").toLowerCase().trim();
  const hasCountry = Boolean(cNorm && cNorm !== "global / todos" && cNorm !== "global" && cNorm !== "todos");
  const primaryCity = hasCountry ? getPrimaryCityForCountry(country || "") : null;

  // Obtener variantes (ej: "b2b marketing" <-> "marketing b2b")
  const allTermVariants: string[] = [];
  const termsToProcess = splitTerms.length > 0 ? splitTerms : (keywords ? [keywords] : []);
  for (const t of termsToProcess) {
    if (!t) continue;
    allTermVariants.push(...getB2bTermVariants(t));
  }
  const uniqueVariants = Array.from(new Set(allTermVariants.filter(Boolean)));

  const queries: string[] = [];

  // Si hay país objetivo definido:
  if (hasCountry && country) {
    // 1. Frases exactas con el país (ej: "marketing b2b" Perú, "b2b marketing" Perú)
    for (const v of uniqueVariants) {
      if (comp) {
        queries.push(`${quoteTerm(comp)} ${quoteTerm(v)} ${country}`);
      } else {
        queries.push(`${quoteTerm(v)} ${country}`);
      }
    }

    // 2. Frases exactas con la ciudad principal del país (ej: "marketing b2b" Lima, "b2b marketing" Lima)
    if (primaryCity) {
      for (const v of uniqueVariants) {
        if (!comp) {
          queries.push(`${quoteTerm(v)} ${primaryCity}`);
        }
      }
    }

    // 3. Búsqueda sin comillas con el país (para tolerancia semántica en LinkedIn)
    for (const v of uniqueVariants) {
      const unquoted = v.replace(/"/g, "").trim();
      if (comp) {
        queries.push(`${comp} ${unquoted} ${country}`);
      } else {
        queries.push(`${unquoted} ${country}`);
      }
    }
  }

  // 4. Frases exactas sin país (fallback estándar - se filtrará estrictamente por país/alfabeto a nivel post)
  for (const v of uniqueVariants) {
    if (comp) {
      queries.push(`${quoteTerm(comp)} ${quoteTerm(v)}`);
    } else {
      queries.push(quoteTerm(v));
    }
  }

  // 5. Fallback: sólo competidor
  if (comp) {
    queries.push(quoteTerm(comp));
  }

  return Array.from(new Set(queries.filter(Boolean)));
}

function scorePost(
  post: UnipileSearchPost,
  icp: { title?: string; country?: string; company?: string; keywords: string[] }
): { score: number; isIcpMatch: boolean; reasons: string[] } {
  const text = (post.text || "").toLowerCase();
  const headline = (post.author?.headline || "").toLowerCase();
  const fullText = `${text} ${headline}`;
  const country = icp.country?.trim() || "";
  const hasCountry = Boolean(country && country !== "Global / Todos" && country !== "Global" && country !== "Todos");

  // 1. Descalificación por alfabeto incompatible (ej: Cirílico ruso si se buscó Perú o España)
  if (hasCountry && hasIncompatibleScript(fullText, country)) {
    return { score: 0, isIcpMatch: false, reasons: ["Alfabeto incompatible con el país objetivo"] };
  }

  // 2. Descalificación por país extranjero contradictorio (ej: Global & Russia si se buscó Perú)
  if (hasCountry && hasConflictingCountry(text, headline, country)) {
    return { score: 0, isIcpMatch: false, reasons: ["Ubicación en país no coincidente"] };
  }

  let score = 25;
  const reasons: string[] = [];
  let hasLocationMatch = false;
  let hasTitleMatch = false;

  // 3. Coincidencia con Ubicación / Territorio
  if (hasCountry) {
    const expandedLocs = expandLocationCriteria([country]);
    const matchLoc = Array.from(expandedLocs).find(
      (loc) => loc.length >= 3 && (text.includes(loc.toLowerCase()) || headline.includes(loc.toLowerCase()))
    );
    if (matchLoc) {
      score += 35;
      hasLocationMatch = true;
      reasons.push(`Ubicación: ${country}`);
    } else if (isSpanishCountry(country) && hasSpanishLanguageIndicators(text)) {
      score += 20;
      reasons.push("Contenido en español");
    } else if (isPortugueseCountry(country) && hasPortugueseLanguageIndicators(text)) {
      score += 20;
      reasons.push("Conteúdo em português");
    }
  } else {
    score += 15;
  }

  // 4. Coincidencia con Cargo / Rol
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
      score += 25;
      hasTitleMatch = true;
      reasons.push(`Autor: ${match}`);
    }
  }

  // 5. Coincidencia con Palabras Clave
  for (const kw of icp.keywords) {
    const clean = kw.toLowerCase().replace(/"/g, "").trim();
    if (!clean) continue;
    const variants = getB2bTermVariants(clean);
    const matchedVariant = variants.find((v) => text.includes(v.toLowerCase()));
    if (matchedVariant) {
      score += 20;
      reasons.push(`Menciona "${clean}"`);
      break;
    }
  }

  // 6. Coincidencia con Industria / Sector
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
      score += 15;
      reasons.push(`Sector: ${matchComp}`);
    }
  }

  const isIcpMatch = hasCountry
    ? (hasTitleMatch && (hasLocationMatch || (isSpanishCountry(country) && hasSpanishLanguageIndicators(text)) || (isPortugueseCountry(country) && hasPortugueseLanguageIndicators(text))))
    : hasTitleMatch;

  return { score: Math.min(100, Math.max(0, score)), isIcpMatch, reasons };
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

    const hasCountry = Boolean(rawCountry && rawCountry !== "Global / Todos" && rawCountry !== "Global" && rawCountry !== "Todos");

    const splitKwList = rawKeywords
      .split(/[,;\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const formatAndFilter = (posts: UnipileSearchPost[]): DiscoveredPostItem[] => {
      const formatted: DiscoveredPostItem[] = posts.map((post) => {
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

      return formatted.filter((p) => {
        if ((p.relevanceScore || 0) <= 0) return false;
        if (hasCountry) {
          const fullText = `${p.text} ${p.author?.headline || ""}`;
          if (hasIncompatibleScript(fullText, rawCountry)) return false;
          if (hasConflictingCountry(p.text, p.author?.headline, rawCountry)) return false;
        }
        return true;
      });
    };

    let validPosts: DiscoveredPostItem[] = [];
    let executedQuery = candidateQueries[0] || rawKeywords;

    for (const q of candidateQueries) {
      executedQuery = q;
      let raw = await executeSearch(q, unipileDatePosted).catch(() => []);
      let filtered = formatAndFilter(raw);

      if (filtered.length === 0 && unipileDatePosted) {
        raw = await executeSearch(q, undefined).catch(() => []);
        filtered = formatAndFilter(raw);
      }

      if (filtered.length > 0) {
        validPosts = filtered;
        break;
      }
    }

    // Ordenar por relevancia e interacción
    if (sort_by === "engagement") {
      validPosts.sort((a, b) => {
        const relDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
        if (relDiff !== 0 && Math.abs(relDiff) >= 15) return relDiff;
        return (b.reactionCount + b.commentCount * 2) - (a.reactionCount + a.commentCount * 2);
      });
    } else if (sort_by === "date") {
      validPosts.sort((a, b) => {
        const relDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
        if (relDiff !== 0 && Math.abs(relDiff) >= 20) return relDiff;
        return 0;
      });
    }

    return res.status(200).json({
      success: true,
      query: executedQuery,
      count: validPosts.length,
      posts: validPosts,
      items: validPosts,
    });
  } catch (error) {
    console.error("[api/signals/posts/search] Error searching posts:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Error al buscar publicaciones en LinkedIn",
    });
  }
}
