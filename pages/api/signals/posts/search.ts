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
  hasRegionalLanguageMatch,
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

export function normalizeText(str: string): string {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function matchesKeywordTerm(text: string, kw: string): boolean {
  if (!text || !kw) return false;
  const normText = normalizeText(text);
  const normKw = normalizeText(kw.trim().replace(/^#+/, ""));
  if (!normKw) return false;

  // 1. Coincidencia directa de subcadena normalizada
  if (normText.includes(normKw)) return true;

  // 2. Formato comprimido o hashtag (ej: "vendas b2b" -> "vendasb2b" coincide con "#VendasB2B")
  const compressedKw = normKw.replace(/[^a-z0-9]/g, "");
  const compressedText = normText.replace(/[^a-z0-9]/g, "");
  if (compressedKw.length >= 3 && compressedText.includes(compressedKw)) return true;

  // 3. Multi-palabra: verificar si todas las palabras principales están en el texto
  const words = normKw.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length > 1) {
    if (words.every((w) => normText.includes(w))) return true;
  }

  // 4. Raíces / lemas frecuentes en español y portugués
  if (normKw.startsWith("prospec") && (normText.includes("prospec") || compressedText.includes("prospec"))) {
    return true;
  }
  if (normKw.startsWith("venda") && (normText.includes("venda") || compressedText.includes("venda"))) {
    return true;
  }

  // 5. Expresión regular con límites de palabra
  const escaped = normKw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, "i");
  return regex.test(normText);
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

  // Si hay competidor definido
  if (comp) {
    // 1. Competidor solo (muy indexable en búsqueda de posts de LinkedIn)
    queries.push(quoteTerm(comp));
    queries.push(comp);

    // 2. Competidor + variante (sin comillas dobles rígidas que causan 0 resultados en LinkedIn)
    for (const v of uniqueVariants) {
      const unquoted = v.replace(/"/g, "").trim();
      queries.push(`${comp} ${unquoted}`);
    }
  }

  // Si hay país objetivo definido:
  if (hasCountry && country) {
    for (const v of uniqueVariants) {
      const unquoted = v.replace(/"/g, "").trim();
      queries.push(`${unquoted} ${country}`);
      queries.push(`${quoteTerm(v)} ${country}`);
    }

    if (primaryCity) {
      for (const v of uniqueVariants) {
        queries.push(`${quoteTerm(v)} ${primaryCity}`);
      }
    }
  }

  // Variantes individuales sin país
  for (const v of uniqueVariants) {
    const unquoted = v.replace(/"/g, "").trim();
    queries.push(unquoted);
    queries.push(quoteTerm(v));
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
    const normText = normalizeText(text);
    const normHeadline = normalizeText(headline);
    const matchLoc = Array.from(expandedLocs).find(
      (loc) => loc.length >= 3 && (normText.includes(normalizeText(loc)) || normHeadline.includes(normalizeText(loc)))
    );
    if (matchLoc) {
      score += 35;
      hasLocationMatch = true;
      reasons.push(`Ubicación: ${country}`);
    } else if (hasRegionalLanguageMatch(text, country)) {
      score += 20;
      reasons.push("Idioma regional");
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
    const normHeadline = normalizeText(headline);
    const match = Array.from(expanded).find(
      (tok) => tok.length >= 3 && normHeadline.includes(normalizeText(tok))
    );
    if (match) {
      score += 25;
      hasTitleMatch = true;
      reasons.push(`Autor: ${match}`);
    }
  }

  // 5. Coincidencia con Palabras Clave
  for (const kw of icp.keywords) {
    const clean = kw.replace(/"/g, "").trim();
    if (!clean) continue;
    const variants = getB2bTermVariants(clean);
    const matchedVariant = variants.find((v) => matchesKeywordTerm(text, v));
    if (matchedVariant || matchesKeywordTerm(text, clean)) {
      score += 25;
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
    const normText = normalizeText(text);
    const normHeadline = normalizeText(headline);
    const matchComp = compTokens.find(
      (tok) => tok.length >= 3 && (normText.includes(normalizeText(tok)) || normHeadline.includes(normalizeText(tok)))
    );
    if (matchComp) {
      score += 15;
      reasons.push(`Sector: ${matchComp}`);
    }
  }

  const isIcpMatch = hasCountry
    ? (hasTitleMatch && (hasLocationMatch || hasRegionalLanguageMatch(text, country)))
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

    // 1. Si se especificó un competidor (ID seleccionado o nombre), buscar directamente sus publicaciones
    const competitorId = typeof req.body?.competitor_id === "string" ? req.body.competitor_id.trim() : "";
    const competitorIsCompany = Boolean(req.body?.competitor_is_company);
    const competitorName = typeof req.body?.competitor_name === "string" ? req.body.competitor_name.trim() : rawCompetitor;

    let targetEntityId = competitorId;
    let targetIsCompany = competitorIsCompany;

    if (!targetEntityId && rawCompetitor) {
      // Auto-resolver si sólo viene el nombre en texto
      const [compRes, peopleRes] = await Promise.allSettled([
        unipile.searchLinkedIn({
          account_id: resolved.unipileAccountId,
          api: "classic",
          category: "companies",
          keywords: rawCompetitor,
          limit: 1,
        }),
        unipile.searchLinkedIn({
          account_id: resolved.unipileAccountId,
          api: "classic",
          category: "people",
          keywords: rawCompetitor,
          limit: 1,
        }),
      ]);

      const foundComp = compRes.status === "fulfilled" ? (compRes.value?.items || [])[0] as any : null;
      const foundPerson = peopleRes.status === "fulfilled" ? (peopleRes.value?.items || [])[0] as any : null;

      if (foundComp?.id && foundComp?.name) {
        targetEntityId = String(foundComp.id);
        targetIsCompany = true;
      } else if (foundPerson?.id && foundPerson?.name) {
        targetEntityId = String(foundPerson.id);
        targetIsCompany = false;
      }
    }

    let competitorOfficialPosts: DiscoveredPostItem[] = [];

    if (targetEntityId) {
      try {
        // Obtener publicaciones reales del perfil o empresa
        const postsRaw = await unipile.getUserPosts({
          account_id: resolved.unipileAccountId,
          identifier: targetEntityId,
          is_company: targetIsCompany,
          limit: Math.max(30, numericLimit),
        });

        const splitKeywords = rawKeywords
          .split(/[,;\n]+/)
          .map((k) => k.trim())
          .filter(Boolean);

        competitorOfficialPosts = (postsRaw as any[]).map((post) => {
          const text = post.text || "";
          const matchedKws = splitKeywords.filter((k) => matchesKeywordTerm(text, k));
          const hasKeywordMatch = matchedKws.length > 0;

          let score = 70;
          if (hasKeywordMatch) {
            score = 90 + Math.min(10, matchedKws.length * 5);
          } else if (splitKeywords.length === 0) {
            score = 80;
          }

          const reasons: string[] = [];
          if (hasKeywordMatch) {
            reasons.push(`Contiene palabra clave: ${matchedKws.join(", ")}`);
          }
          reasons.push(`Publicación oficial de ${post.author?.name || competitorName}`);

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
              id: post.author?.id || targetEntityId,
              name: post.author?.name || competitorName || "Competidor",
              headline: post.author?.headline || null,
              profilePictureUrl: post.author?.profile_picture_url || null,
              publicIdentifier: post.author?.public_identifier || null,
              isCompany: Boolean(post.author?.is_company ?? targetIsCompany),
            },
            relevanceScore: score,
            isIcpMatch: splitKeywords.length === 0 || hasKeywordMatch,
            relevanceReasons: reasons,
          };
        });

        // Si se indicaron palabras clave, ordenar primero los posts con coincidencia directa
        if (splitKeywords.length > 0) {
          competitorOfficialPosts.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
        }
      } catch (err) {
        console.warn("[api/signals/posts/search] Error fetching target entity posts:", err);
      }
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
          keywords: splitKwList.length > 0 ? splitKwList : (rawKeywords ? [rawKeywords] : []),
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

    let validSearchPosts: DiscoveredPostItem[] = [];
    let executedQuery = candidateQueries[0] || rawKeywords || rawCompetitor;

    if (candidateQueries.length > 0) {
      for (const q of candidateQueries) {
        executedQuery = q;
        let raw = await executeSearch(q, unipileDatePosted).catch(() => []);
        let filtered = formatAndFilter(raw);

        if (filtered.length === 0 && unipileDatePosted) {
          raw = await executeSearch(q, undefined).catch(() => []);
          filtered = formatAndFilter(raw);
        }

        if (filtered.length > 0) {
          validSearchPosts = filtered;
          break;
        }
      }
    }

    // Combinar posts oficiales del competidor y posts de búsqueda general
    const seenPostIds = new Set<string>();
    const allCombinedPosts: DiscoveredPostItem[] = [];

    // 1. Agregar publicaciones oficiales del competidor (prioritarias)
    for (const p of competitorOfficialPosts) {
      const key = p.id || p.shareUrl;
      if (key && !seenPostIds.has(key)) {
        seenPostIds.add(key);
        allCombinedPosts.push(p);
      }
    }

    // 2. Agregar posts de búsqueda general
    for (const p of validSearchPosts) {
      const key = p.id || p.shareUrl;
      if (key && !seenPostIds.has(key)) {
        seenPostIds.add(key);
        allCombinedPosts.push(p);
      }
    }

    // Filtrar por fecha con fallback seguro (no vaciar a 0 si las publicaciones disponibles son anteriores)
    let filteredByDate = allCombinedPosts;
    if (unipileDatePosted && allCombinedPosts.length > 0) {
      const now = Date.now();
      const maxAgeMs =
        unipileDatePosted === "past_24h"
          ? 24 * 60 * 60 * 1000
          : unipileDatePosted === "past_week"
          ? 7 * 24 * 60 * 60 * 1000
          : 31 * 24 * 60 * 60 * 1000;

      const dateFiltered = allCombinedPosts.filter((p) => {
        if (!p.parsedDatetime) return true;
        const postTime = new Date(p.parsedDatetime).getTime();
        return !isNaN(postTime) && now - postTime <= maxAgeMs;
      });
      if (dateFiltered.length > 0) {
        filteredByDate = dateFiltered;
      }
    }

    // Ordenar resultados combinados
    if (sort_by === "engagement") {
      filteredByDate.sort((a, b) => {
        const scoreDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
        if (scoreDiff !== 0 && Math.abs(scoreDiff) >= 15) return scoreDiff;
        const engA = a.reactionCount + a.commentCount * 2 + a.repostCount * 3;
        const engB = b.reactionCount + b.commentCount * 2 + b.repostCount * 3;
        return engB - engA;
      });
    } else {
      filteredByDate.sort((a, b) => {
        const timeA = a.parsedDatetime ? new Date(a.parsedDatetime).getTime() : 0;
        const timeB = b.parsedDatetime ? new Date(b.parsedDatetime).getTime() : 0;
        return timeB - timeA;
      });
    }

    const finalPosts = filteredByDate.slice(0, numericLimit);

    return res.status(200).json({
      success: true,
      entity: targetEntityId
        ? {
            id: targetEntityId,
            name: competitorName,
            is_company: targetIsCompany,
          }
        : undefined,
      query: competitorName
        ? `Publicaciones de ${competitorName}${rawKeywords ? ` con "${rawKeywords}"` : ""}`
        : executedQuery,
      count: finalPosts.length,
      posts: finalPosts,
      items: finalPosts,
    });
  } catch (error) {
    console.error("[api/signals/posts/search] Error searching posts:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Error al buscar publicaciones en LinkedIn",
    });
  }
}
