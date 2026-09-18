import type { SignalIcpFilters } from "../schema";
import type { DiscoveredSignalLead, SignalScanResult, SignalScannerContext } from "./contracts";
import { SignalScanError } from "./contracts";
import { evidenceFingerprint, extractCompanyFromHeadline } from "./scoring";
import { type SignalScannerClient, resolveLocationIds } from "./index";
import type { WebSearchClient, WebSearchResult } from "@/lib/serper/client";
import type { UnipileSearchPerson } from "@/lib/unipile/types";

const BLOCKED_DOMAINS = [
  "facebook.com", "instagram.com", "youtube.com", "tiktok.com", "reddit.com",
  "pinterest.com", "x.com", "twitter.com", "linkedin.com",
];

function normalize(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b([a-zA-Z])\.([a-zA-Z])(?:\.([a-zA-Z]))?(?:\.([a-zA-Z]))?/g, "$1$2$3$4")
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|ltda|sa|sas|sl|srl|spa|plc|corp|corporation|company|co|gmbh|eirl)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sourceDomain(link: string): string | null {
  try { return new URL(link).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return null; }
}

function hasCountryListFootprint(text: string): boolean {
  // Detecta footprints de dropdowns o listados alfabéticos de países en el pie de página
  return /(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?\s*;\s*){3,}/i.test(text)
    || /\b(?:Christmas Island|Cocos Islands|Cook Islands|Faroe Islands|Falkland Islands)\b/i.test(text);
}

function acceptableSource(result: WebSearchResult): boolean {
  const domain = sourceDomain(result.link);
  if (!domain || BLOCKED_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))) {
    return false;
  }
  if (hasCountryListFootprint(result.snippet || "") || hasCountryListFootprint(result.title || "")) {
    return false;
  }
  return true;
}

function relativeDate(value: string | null, nowMs: number): string | null {
  if (!value) return null;
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return new Date(direct).toISOString();
  const match = value.toLowerCase().match(/(\d+)\s*(minute|hour|day|week|month|year|minuto|hora|d[ií]a|semana|mes|año)s?/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  const factors: Record<string, number> = {
    minute: 60_000, minuto: 60_000,
    hour: 3_600_000, hora: 3_600_000,
    day: 86_400_000, "día": 86_400_000, dia: 86_400_000,
    week: 604_800_000, semana: 604_800_000,
    month: 2_592_000_000, mes: 2_592_000_000,
    year: 31_536_000_000, año: 31_536_000_000,
  };
  return factors[unit] ? new Date(nowMs - amount * factors[unit]).toISOString() : null;
}

function cleanCompany(value: string): string | null {
  const cleaned = value
    .replace(/^(the|startup|empresa|la empresa)\s+/i, "")
    .replace(/[,:|–—-].*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 2 && cleaned.length <= 100 ? cleaned : null;
}

function extractCompany(result: WebSearchResult, type: string): string | null {
  const corpus = [result.snippet || "", result.title];
  const verbs = type === "acquisition_event"
    ? "acquires|acquired|to acquire|compra|adquiere|adquirió"
    : type === "industry_event"
      ? "speaks at|attends|participa en|presenta en|asiste a"
      : "has raised|raises|raised|secures|secured|closes|closed|lands|announces|levantó|levanta|recaudó|recauda|obtuvo|cierra|cerró|anuncia";
  const pattern = new RegExp(`^(.{2,100}?)\\s+(?:${verbs})\\b`, "i");
  for (const text of corpus) {
    const match = text.trim().match(pattern);
    if (match?.[1]) {
      const candidate = cleanCompany(match[1].replace(/^.*?\bstartup\s+/i, ""));
      if (candidate) return candidate;
    }
  }
  const startup = result.title.match(/\bstartup\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ&.-]*(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ&.-]*){0,3})/);
  if (startup?.[1]) return cleanCompany(startup[1]);
  return null;
}

function extractAmount(text: string): string | null {
  const match = text.match(/(?:US\$|USD\s?|€|\$)\s?\d+(?:[.,]\d+)?\s?(?:million|millones?|millón|m|billion|billones?|b)\b/i);
  return match?.[0] || null;
}

function titleMatches(headline: string | null | undefined, titles: string[]): boolean {
  if (titles.length === 0) return true;
  const normalized = normalize(headline);
  return titles.some((title) => normalized.includes(normalize(title)));
}

const CORPORATE_SUFFIXES = new Set([
  "inc", "llc", "ltd", "ltda", "sa", "sas", "sl", "srl", "spa", "plc",
  "corp", "corporation", "company", "co", "gmbh", "eirl", "group", "holding",
  "tech", "technologies", "technology", "solutions", "chile", "mexico", "colombia",
  "espana", "spain", "argentina", "peru", "brasil", "brazil", "latam", "global", "international",
  "health", "lab", "labs", "s", "a",
]);

function companyTokens(name: string): string[] {
  const norm = normalize(name);
  return norm.split(/\s+/).filter((w) => w.length > 0 && !CORPORATE_SUFFIXES.has(w));
}

export function companyMatches(profileCompany: string | null | undefined, expected: string): boolean {
  if (!profileCompany || !expected) return false;
  const actualNorm = normalize(profileCompany);
  const wantedNorm = normalize(expected);
  if (!actualNorm || !wantedNorm) return false;

  // 1. Coincidencia exacta directa
  if (actualNorm === wantedNorm) return true;

  const wantedTokens = companyTokens(expected);
  const actualTokens = companyTokens(profileCompany);
  if (wantedTokens.length === 0 || actualTokens.length === 0) {
    return actualNorm === wantedNorm;
  }

  const wantedCore = wantedTokens.join(" ");
  const actualCore = actualTokens.join(" ");
  if (wantedCore === actualCore) return true;

  // 2. Si la empresa esperada tiene una sola palabra (ej: "Integral", "NotCo", "Stripe"):
  // No permitir coincidencias con empresas que añaden palabras no corporativas ("Tapiz Decoración Integral")
  if (wantedTokens.length === 1) {
    // Si los tokens centrales son exactamente iguales
    if (actualTokens.length === 1 && actualTokens[0] === wantedTokens[0]) return true;
    // O si la empresa empieza exactamente con ese nombre y sólo añade 1 token corporativo/secundario (ej: "Betterfly Health")
    if (actualTokens.length <= 2 && actualTokens[0] === wantedTokens[0]) {
      return true;
    }
    return false;
  }

  // 3. Para empresas de 2 o más palabras clave:
  const allWantedInActual = wantedTokens.every((t) => actualTokens.includes(t));
  if (allWantedInActual && actualTokens.length <= wantedTokens.length + 1) {
    return true;
  }
  const allActualInWanted = actualTokens.every((t) => wantedTokens.includes(t));
  if (allActualInWanted && wantedTokens.length <= actualTokens.length + 1) {
    return true;
  }

  return false;
}

function personCandidate(item: unknown): item is UnipileSearchPerson {
  return Boolean(item && typeof item === "object" && (item as { type?: string }).type === "PEOPLE");
}

function timeRange(days: number): "day" | "week" | "month" | "year" {
  if (days <= 1) return "day";
  if (days <= 7) return "week";
  if (days <= 31) return "month";
  return "year";
}

function locationCode(icp: SignalIcpFilters): string {
  const value = normalize(icp.locations?.[0]);
  const codes: Record<string, string> = {
    espana: "es", spain: "es", mexico: "mx", colombia: "co", argentina: "ar",
    chile: "cl", peru: "pe", brasil: "br", brazil: "br", usa: "us", "estados unidos": "us",
  };
  return codes[value] || "us";
}

function webQuery(context: SignalScannerContext): string {
  const titles = context.icp.titles?.length ? `(${context.icp.titles.map((title) => `"${title}"`).join(" OR ")})` : "(CEO OR Founder OR Director)";
  const location = context.icp.locations?.length ? `"${context.icp.locations[0]}"` : "";
  const terms: Record<string, string> = {
    funding_round: '("funding round" OR "raised funding" OR "ronda de inversión" OR "levantó inversión" OR "recaudó")',
    acquisition_event: '(acquisition OR acquired OR acquires OR adquisición OR adquirió)',
    industry_event: '(conference OR summit OR event OR conferencia OR feria)',
    company_news: '(announcement OR expansion OR launch OR noticia OR anuncio OR expansión)',
    keyword_intent: context.keywords.length ? `(${context.keywords.map((keyword) => `"${keyword}"`).join(" OR ")})` : "",
  };

  const activeKinds = (context.icp.event_kinds && context.icp.event_kinds.length > 0)
    ? context.icp.event_kinds
    : [context.monitor.type];

  const matchedTerms = activeKinds
    .map((kind) => terms[kind])
    .filter(Boolean);

  if (context.keywords.length && terms.keyword_intent && !matchedTerms.includes(terms.keyword_intent)) {
    matchedTerms.push(terms.keyword_intent);
  }

  const queryTerms = matchedTerms.length > 1
    ? `(${matchedTerms.join(" OR ")})`
    : (matchedTerms[0] || context.keywords.join(" OR "));

  return [queryTerms, titles, location].filter(Boolean).join(" ");
}

const MAX_SERPER_SEARCHES_PER_SCAN = 4;
const SERPER_COURTESY_DELAY_MS = 350;
const MAX_LEADS_PER_ARTICLE = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SerperBudget {
  searchesUsed: number;
  maxSearches: number;
}

async function findPeople(
  linkedIn: SignalScannerClient,
  web: WebSearchClient,
  context: SignalScannerContext,
  company: string,
  locationIds: string[] = [],
  budget?: SerperBudget,
): Promise<Array<{ url: string; name: string; providerId?: string | null; company?: string }>> {
  const titles = context.icp.titles?.length ? context.icp.titles : ["CEO", "Founder"];
  const candidates: Array<{ url: string; name: string; providerId?: string | null; company?: string }> = [];
  try {
    const response = await linkedIn.searchLinkedIn({
      account_id: context.remoteAccountId,
      api: "classic",
      category: "people",
      limit: Math.min(10, context.limit),
      advanced_keywords: { title: titles.join(" OR "), company },
      ...(locationIds.length ? { location: locationIds } : {}),
    });
    for (const person of response.items.filter(personCandidate)) {
      const url = person.profile_url || person.public_profile_url || (person.public_identifier ? `https://www.linkedin.com/in/${person.public_identifier}/` : "");
      if (url && person.name) candidates.push({ url, name: person.name, providerId: person.id, company });
    }
  } catch {
    // X-Ray fallback below still verifies every candidate through LinkedIn profile retrieval.
  }
  if (candidates.length > 0) return candidates;

  // Límite de presupuesto Serper por scan run para proteger créditos y evitar 429
  if (budget && budget.searchesUsed >= budget.maxSearches) {
    return candidates;
  }
  if (budget) {
    budget.searchesUsed++;
    await sleep(SERPER_COURTESY_DELAY_MS);
  }

  const xray = await web.search({
    query: `site:linkedin.com/in/ (${titles.map((title) => `"${title}"`).join(" OR ")}) "${company}"`,
    country: locationCode(context.icp),
    language: "es",
    limit: Math.min(10, context.limit),
  });
  for (const result of xray.items) {
    try {
      const url = new URL(result.link);
      const match = url.pathname.match(/\/in\/([^/]+)/i);
      if (!match) continue;
      const rawName = result.title.replace(/\s*[-|].*$/, "").trim();
      if (rawName) candidates.push({ url: `https://www.linkedin.com/in/${match[1]}/`, name: rawName, company });
    } catch {}
  }
  return candidates;
}

export async function scanWebSignals(
  web: WebSearchClient,
  linkedIn: SignalScannerClient,
  context: SignalScannerContext,
  nowMs = Date.now(),
): Promise<SignalScanResult> {
  if (!web.isConfigured()) throw new SignalScanError("La fuente web complementaria no está configurada", "unsupported_capability", false);
  const query = webQuery(context);
  if (!query.trim()) throw new SignalScanError("La búsqueda web necesita palabras clave", "invalid_configuration", false);
  const response = await web.search({
    query,
    country: locationCode(context.icp),
    language: "es",
    limit: 10,
    timeRange: timeRange(context.icp.time_window_days || 30),
  });
  const articles = response.items.filter(acceptableSource);
  const leads: DiscoveredSignalLead[] = [];
  const seenArticles = new Set<string>();
  const locationIds = await resolveLocationIds(linkedIn, context);
  const budget: SerperBudget = {
    searchesUsed: 1, // Búsqueda inicial de noticias ya consumida
    maxSearches: MAX_SERPER_SEARCHES_PER_SCAN,
  };

  for (const article of articles) {
    if (leads.length >= context.limit) break;
    let canonical: string;
    try {
      const url = new URL(article.link);
      url.hash = "";
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((key) => url.searchParams.delete(key));
      canonical = url.toString();
    } catch { continue; }
    if (seenArticles.has(canonical)) continue;
    seenArticles.add(canonical);
    const company = extractCompany(article, context.monitor.type);
    if (!company) continue;
    let people: Awaited<ReturnType<typeof findPeople>>;
    try { people = await findPeople(linkedIn, web, context, company, locationIds, budget); }
    catch { continue; }
    let articleLeadsCount = 0;
    for (const candidate of people) {
      if (leads.length >= context.limit) break;
      if (articleLeadsCount >= MAX_LEADS_PER_ARTICLE) break;
      try {
        const profile = await linkedIn.resolveProfile(candidate.url, context.remoteAccountId);
        const current = profile.work_experience?.find((role) => role.current) || profile.work_experience?.[0];
        const inferredFromHeadline = extractCompanyFromHeadline(profile.headline);

        // Plan B: Si LinkedIn vacía work_experience por throttling, verificar contra headline o candidate.company
        const companyVerified = companyMatches(current?.company, company)
          || companyMatches(profile.headline, company)
          || companyMatches(inferredFromHeadline, company)
          || (candidate.company && companyMatches(candidate.company, company));

        if (!companyVerified) continue;
        const headline = profile.headline || current?.position || null;
        if (!titleMatches(headline, context.icp.titles || [])) continue;
        const name = `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || candidate.name;
        const profileUrl = profile.public_profile_url || profile.profile_url || candidate.url;
        const snippet = [article.title, article.snippet].filter(Boolean).join(" — ").slice(0, 500);
        const amount = extractAmount(`${article.title} ${article.snippet || ""}`);
        const effectiveCompany = current?.company || inferredFromHeadline || candidate.company || company;

        leads.push({
          linkedinUrl: profileUrl,
          providerId: profile.provider_id || candidate.providerId || null,
          fullName: name,
          headline,
          company: effectiveCompany,
          location: profile.location || current?.location || null,
          signalType: context.monitor.type,
          evidence: {
            fingerprint: evidenceFingerprint({
              monitorId: context.monitor.id,
              sourceType: "web_public_evidence",
              sourceId: canonical,
              sourceUrl: canonical,
              providerId: profile.provider_id,
              snippet,
            }),
            sourceType: "web_public_evidence",
            sourceId: canonical,
            sourceUrl: canonical,
            occurredAt: relativeDate(article.date, nowMs),
            snippet,
            metadata: {
              evidenceTitle: article.title,
              evidenceSource: article.source || sourceDomain(article.link),
              evidenceDateLabel: article.date,
              company: effectiveCompany,
              amount,
              identityVerified: true,
              sourceStrategy: context.icp.source_strategy || "hybrid",
              resolvedProfile: profile,
              throttledExperience: Boolean(profile.throttled_sections?.includes("experience") || !profile.work_experience?.length),
            },
          },
        });
        articleLeadsCount++;
      } catch {
        // Never emit a web lead unless the LinkedIn identity and current company verify.
      }
    }
  }
  return {
    leads,
    cursor: null,
    capability: "public_web_evidence+linkedin_identity",
  };
}
