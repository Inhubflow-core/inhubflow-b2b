import type { SignalIcpFilters } from "../schema";
import type { DiscoveredSignalLead, SignalScanResult, SignalScannerContext } from "./contracts";
import { SignalScanError } from "./contracts";
import { evidenceFingerprint, extractCompanyFromHeadline, companyMatches, isAllOrWildcardTitle } from "./scoring";
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

const INVALID_COMPANY_NAMES = new Set([
  "spain", "espana", "españa", "chile", "mexico", "mexicana", "mexicano",
  "colombia", "colombiana", "colombiano", "argentina", "argentino",
  "peru", "peruana", "peruano", "brasil", "brazil", "usa", "eeuu",
  "estados unidos", "united states", "uk", "reino unido", "france", "francia",
  "germany", "alemania", "italia", "italy", "italiana", "italiano",
  "portugal", "uruguay", "ecuador", "panama", "costa rica", "canada",
  "startup", "startups", "fundador", "founder", "ceo"
]);

function cleanCompany(value: string): string | null {
  const cleaned = value
    .replace(/^(the|startup|empresa|la empresa)\s+/i, "")
    .replace(/[,:|–—-].*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 35) return null;
  const words = cleaned.split(/\s+/);
  if (words.length > 4) return null;
  if (!/^[A-ZÁÉÍÓÚÑ0-9]/.test(cleaned)) return null;
  if (/^(?:¿|si|por|estos|estas|los|las|un|una|el|la|su|sus|cada|todo|toda|tras|segun|según)\b/i.test(cleaned)) return null;
  if (/\b(?:dice|hace|tienen|tiene|pide|piden|esta|está|estan|están|seran|serán|debe|deben|puede|pueden)\b/i.test(cleaned)) return null;
  const norm = normalize(cleaned);
  if (INVALID_COMPANY_NAMES.has(norm)) return null;
  if (/^(?:spain|españa|chile|mexico|colombia|argentina|peru|brasil)[-\s]+based/i.test(value)) return null;
  return cleaned;
}

const CORPORATE_ACTION_VERBS = [
  "has raised", "raises", "raised", "secures", "secured", "closes", "closed", "lands",
  "levantó", "levanta", "recaudó", "recauda", "obtuvo", "obtiene", "cierra", "cerró",
  "recibe financiamiento", "recibe inversión", "recibe", "recibió",
  "amarra financiamiento", "amarra", "amarró", "capta", "captó", "consigue", "consiguió",
  "acelera su expansión", "acelera expansión", "fortalece su expansión", "continúa su expansión",
  "consolida su expansión", "anuncia su expansión", "anuncia expansión", "amplía su presencia",
  "invierte en", "invierte", "invertirá", "apuesta por",
  "abre nuevo", "abre su", "abre oficinas", "abre centro", "inaugura",
  "analiza deuda para financiar", "financia su", "financia",
  "llega a", "pone en marcha", "pone otra pieza a su expansión", "anuncia", "announces",
  "acquires", "acquired", "to acquire", "compra", "adquiere", "adquirió",
  "speaks at", "attends", "participa en", "presenta en", "asiste a"
].sort((a, b) => b.length - a.length);

const CORPORATE_ACTION_VERB_REGEX = new RegExp(`\\b(${CORPORATE_ACTION_VERBS.join("|")})\\b`, "i");

function extractCompany(result: WebSearchResult, type: string): string | null {
  const corpus = [result.title, result.snippet || ""];
  for (const rawText of corpus) {
    const text = rawText
      .replace(/^(?:economía|noticias|actualidad|news|breaking|reportaje|entrevista)[\s.:–-]+/i, "")
      .replace(/^[A-ZÁÉÍÓÚÑa-záéíóúñ]+'s\s+/i, "")
      .trim();

    const match = text.match(CORPORATE_ACTION_VERB_REGEX);
    if (match && typeof match.index === "number" && match.index > 0) {
      const before = text.slice(0, match.index).trim();
      const cleanedCandidate = before
        .replace(/^(?:la\s+|el\s+)?(?:startup|fintech|empresa|compañía|proptech|edtech|cadena|marca|holding|grupo)\s+(?:española\s+|chilena\s+|mexicana\s+|colombiana\s+)?/i, "")
        .replace(/^(?:en|para|tras|con)\s+/i, "")
        .replace(/[,:–—-].*$/, "")
        .trim();
      const candidate = cleanCompany(cleanedCandidate);
      if (candidate) return candidate;
    }

    const startupMatch = text.match(/\b(?:startup|fintech|empresa|marca)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ&.-]*(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ&.-]*){0,3})/i);
    if (startupMatch?.[1]) {
      const candidate = cleanCompany(startupMatch[1]);
      if (candidate) return candidate;
    }
  }

  return null;
}

function extractAmount(text: string): string | null {
  const match = text.match(/(?:US\$|USD\s?|€|\$)\s?\d+(?:[.,]\d+)?\s?(?:million|millones?|millón|m|billion|billones?|b)\b/i);
  return match?.[0] || null;
}

export function extractFoundersFromArticle(text: string): string[] {
  const founders: string[] = [];
  const patterns = [
    /(?:fundad[oa] por|founded by|co-founders?|cofundadores?|socios?)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?(?:\s*,\s*[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)*(?:\s+(?:y|and)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?))/gi,
    /(?:co-founder and CEO|CEO and co-founder|founder and CEO|co-founder|founder|CEO|fundador(?:a)? y CEO|director(?:a)? ejecutivo|fundador(?:a)?|co-fundador(?:a)?)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,2})/gi,
  ];

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        const rawNames = match[1].split(/\s*(?:,| y | and )\s*/i);
        for (const raw of rawNames) {
          const clean = raw.replace(/[^\w\sÁÉÍÓÚÑáéíóúñ]/g, "").trim();
          if (clean.length >= 4 && clean.split(/\s+/).length >= 2 && !founders.includes(clean)) {
            founders.push(clean);
          }
        }
      }
    }
  }
  return founders;
}

export function effectiveTitles(requestedTitles: string[] | undefined, signalType: string): string[] {
  const clean = (requestedTitles || []).filter((t) => !isAllOrWildcardTitle(t));
  const base = clean.length > 0 ? [...clean] : ["CEO", "Founder", "Director"];
  const isFounderQuery = base.some((t) => /ceo|founder|fundador|director|socio|co-founder|cofundador/i.test(t));
  if (isFounderQuery || ["funding_round", "company_growth", "acquisition_event", "company_news"].includes(signalType)) {
    const founderVariants = ["CEO", "Founder", "Co-Founder", "Cofundador", "Co-Fundador", "Socio Fundador", "Partner", "Director"];
    for (const v of founderVariants) {
      if (!base.some((b) => b.toLowerCase() === v.toLowerCase())) {
        base.push(v);
      }
    }
  }
  return base;
}

function titleMatches(headline: string | null | undefined, titles: string[], signalType = "funding_round"): boolean {
  const clean = (titles || []).filter((t) => !isAllOrWildcardTitle(t));
  if (clean.length === 0) return true;
  const normalized = normalize(headline);
  const effTitles = effectiveTitles(clean, signalType);
  return effTitles.some((title) => normalized.includes(normalize(title)));
}

export { companyMatches };


function personCandidate(item: unknown): item is UnipileSearchPerson {
  return Boolean(item && typeof item === "object" && (item as { type?: string }).type === "PEOPLE");
}

function timeRange(days: number): "day" | "week" | "month" | "year" {
  if (days <= 1) return "day";
  if (days <= 7) return "week";
  if (days <= 31) return "month";
  return "year";
}

const COUNTRY_CODES: Record<string, string> = {
  espana: "es", spain: "es", mexico: "mx", colombia: "co", argentina: "ar",
  chile: "cl", peru: "pe", brasil: "br", brazil: "br", usa: "us", "estados unidos": "us",
  italia: "it", italy: "it", francia: "fr", france: "fr", alemania: "de", germany: "de",
  portugal: "pt", uk: "gb", "reino unido": "gb", "united kingdom": "gb",
  uruguay: "uy", ecuador: "ec", panama: "pa", "costa rica": "cr",
  "república dominicana": "do", "republica dominicana": "do", guatemala: "gt",
  bolivia: "bo", paraguay: "py", canada: "ca", "países bajos": "nl", "paises bajos": "nl",
  netherlands: "nl", holanda: "nl", suiza: "ch", switzerland: "ch", suecia: "se",
  sweden: "se", irlanda: "ie", ireland: "ie", australia: "au", israel: "il",
  polonia: "pl", poland: "pl", belgica: "be", belgium: "be", austria: "at",
};

function locationCode(icp: SignalIcpFilters): string {
  const value = normalize(icp.locations?.[0]);
  return COUNTRY_CODES[value] || "us";
}

function searchLanguage(countryCode: string): string {
  const LANG_MAP: Record<string, string> = {
    es: "es", mx: "es", co: "es", ar: "es", cl: "es", pe: "es", uy: "es", ec: "es", pa: "es", cr: "es", do: "es", gt: "es", bo: "es", py: "es",
    it: "it",
    fr: "fr",
    de: "de", at: "de",
    pt: "pt", br: "pt",
    gb: "en", us: "en", ca: "en", au: "en", ie: "en", il: "en", nl: "en", se: "en", ch: "en",
  };
  return LANG_MAP[countryCode] || "es";
}

function locationQueryTerm(location: string): string {
  const norm = normalize(location);
  const DEMONYMS: Record<string, string> = {
    colombia: '("Colombia" OR "colombiana" OR "colombiano")',
    chile: '("Chile" OR "chilena" OR "chileno")',
    mexico: '("México" OR "mexicana" OR "mexicano" OR "Mexico")',
    argentina: '("Argentina" OR "argentina" OR "argentino")',
    espana: '("España" OR "española" OR "español" OR "Spain")',
    spain: '("España" OR "española" OR "español" OR "Spain")',
    peru: '("Perú" OR "peruana" OR "peruano" OR "Peru")',
    brasil: '("Brasil" OR "brasileña" OR "brasileño" OR "Brazil" OR "Brazilian")',
    brazil: '("Brasil" OR "brasileña" OR "brasileño" OR "Brazil" OR "Brazilian")',
    italia: '("Italia" OR "italiana" OR "italiano" OR "Italy" OR "Italian")',
    italy: '("Italia" OR "italiana" OR "italiano" OR "Italy" OR "Italian")',
    francia: '("Francia" OR "francesa" OR "francés" OR "France" OR "French")',
    france: '("Francia" OR "francesa" OR "francés" OR "France" OR "French")',
    alemania: '("Alemania" OR "alemana" OR "alemán" OR "Germany" OR "German")',
    germany: '("Alemania" OR "alemana" OR "alemán" OR "Germany" OR "German")',
    portugal: '("Portugal" OR "portuguesa" OR "portugués" OR "Portuguese")',
    uruguay: '("Uruguay" OR "uruguaya" OR "uruguayo")',
    ecuador: '("Ecuador" OR "ecuatoriana" OR "ecuatoriano")',
    panama: '("Panamá" OR "Panama" OR "panameña" OR "panameño")',
    "costa rica": '("Costa Rica" OR "costarricense")',
    "reino unido": '("Reino Unido" OR "británica" OR "británico" OR "UK" OR "United Kingdom" OR "British")',
    uk: '("Reino Unido" OR "británica" OR "británico" OR "UK" OR "United Kingdom" OR "British")',
    "estados unidos": '("Estados Unidos" OR "estadounidense" OR "USA" OR "United States" OR "American")',
    usa: '("Estados Unidos" OR "estadounidense" OR "USA" OR "United States" OR "American")',
    canada: '("Canadá" OR "Canada" OR "canadiense" OR "Canadian")',
    "paises bajos": '("Países Bajos" OR "Netherlands" OR "Holanda" OR "Dutch")',
    netherlands: '("Países Bajos" OR "Netherlands" OR "Holanda" OR "Dutch")',
    suiza: '("Suiza" OR "suizo" OR "Switzerland" OR "Swiss")',
    switzerland: '("Suiza" OR "suizo" OR "Switzerland" OR "Swiss")',
    suecia: '("Suecia" OR "Sweden" OR "Swedish")',
    sweden: '("Suecia" OR "Sweden" OR "Swedish")',
    irlanda: '("Irlanda" OR "Ireland" OR "Irish")',
    ireland: '("Irlanda" OR "Ireland" OR "Irish")',
  };
  return DEMONYMS[norm] || `"${location}"`;
}

function webQuery(context: SignalScannerContext): string {
  const targetLocation = context.icp.locations?.[0]?.trim() || "";
  const locationClean = targetLocation ? (targetLocation.includes(" ") ? `"${targetLocation}"` : targetLocation) : "";
  const expansionTerm = targetLocation ? `"expansión en ${targetLocation}"` : '"expansión"';

  const eventTermsMap: Record<string, string[]> = {
    funding_round: ['"ronda de inversión"', '"Serie A"', '"capital semilla"'],
    company_news: ['"anuncia inversión"', expansionTerm],
    acquisition_event: ['"adquisición"', '"compra de"', '"adquirió"'],
    industry_event: ["conferencia", "summit", "congreso"],
  };

  const activeKinds = (context.icp.event_kinds && context.icp.event_kinds.length > 0)
    ? context.icp.event_kinds
    : [context.monitor.type];

  const flatTerms: string[] = [];
  for (const kind of activeKinds) {
    if (eventTermsMap[kind]) flatTerms.push(...eventTermsMap[kind]);
  }

  // Tomar hasta 3 o 4 términos clave para que Google News no devuelva 0 resultados por exceso de operadores
  const uniqueTerms = Array.from(new Set(flatTerms)).slice(0, 4);
  const eventClause = uniqueTerms.length > 0 ? `(${uniqueTerms.join(" OR ")})` : "";
  const companyTarget = context.icp.company ? `"${context.icp.company}"` : "";

  const hasMarketEvents = uniqueTerms.length > 0;
  const domainKeywords = !hasMarketEvents
    ? (context.keywords || []).filter((k) => {
        const norm = normalize(k);
        return !/ronda|inversion|inversión|funding|capital|semilla|serie a|acquisition|adquisicion|adquisición|evento|noticia|anuncio/i.test(norm);
      }).slice(0, 3)
    : [];
  const keywordClause = domainKeywords.length > 0
    ? `(${domainKeywords.map((k) => (k.includes(" ") ? `"${k}"` : k)).join(" OR ")})`
    : "";

  return [companyTarget, eventClause, keywordClause, locationClean].filter(Boolean).join(" ");
}

const MAX_SERPER_SEARCHES_PER_SCAN = 8;
const SERPER_COURTESY_DELAY_MS = 350;
const MAX_LEADS_PER_ARTICLE = 3;

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
  namedFounders: string[] = [],
): Promise<Array<{ url: string; name: string; providerId?: string | null; company?: string }>> {
  const titles = effectiveTitles(context.icp.titles, context.monitor.type);
  const candidates: Array<{ url: string; name: string; providerId?: string | null; company?: string }> = [];

  // Paso 1: Si la noticia menciona socios o co-fundadores por nombre, buscarlos directamente en LinkedIn
  for (const founderName of namedFounders) {
    const parts = founderName.split(/\s+/);
    if (parts.length < 2) continue;
    try {
      const resp = await linkedIn.searchLinkedIn({
        account_id: context.remoteAccountId,
        api: "classic",
        category: "people",
        limit: 3,
        advanced_keywords: { title: titles.join(" OR "), company, first_name: parts[0], last_name: parts.slice(1).join(" ") },
        ...(locationIds.length ? { location: locationIds } : {}),
      });
      for (const person of resp.items.filter(personCandidate)) {
        const url = person.profile_url || person.public_profile_url || (person.public_identifier ? `https://www.linkedin.com/in/${person.public_identifier}/` : "");
        if (url && person.name && !candidates.some((c) => c.url === url)) {
          candidates.push({ url, name: person.name, providerId: person.id, company });
        }
      }
    } catch {}
  }

  // Paso 2: Búsqueda amplia en LinkedIn para el comité fundador / socios
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
      if (url && person.name && !candidates.some((c) => c.url === url)) {
        candidates.push({ url, name: person.name, providerId: person.id, company });
      }
    }
  } catch {
    // X-Ray fallback below still verifies every candidate through LinkedIn profile retrieval.
  }
  const locCode = locationCode(context.icp);
  const lang = searchLanguage(locCode);
  const locationFilter = context.icp.locations?.length ? `"${context.icp.locations[0]}"` : "";

  // Si la noticia nombró fundadores y la API directa no los halló, buscarlos por X-Ray prioritario
  if (candidates.length === 0 && namedFounders.length > 0 && (!budget || budget.searchesUsed < budget.maxSearches)) {
    for (const founderName of namedFounders.slice(0, 2)) {
      if (budget && budget.searchesUsed >= budget.maxSearches) break;
      if (budget) {
        budget.searchesUsed++;
        await sleep(SERPER_COURTESY_DELAY_MS);
      }
      try {
        const founderXray = await web.search({
          query: `site:linkedin.com/in/ "${founderName}" "${company}"`,
          country: locCode,
          language: lang,
          limit: 3,
        });
        for (const result of founderXray.items) {
          const url = new URL(result.link);
          const match = url.pathname.match(/\/in\/([^/]+)/i);
          if (!match) continue;
          const rawName = result.title.replace(/\s*[-|].*$/, "").trim();
          if (rawName && !candidates.some((c) => c.url.includes(match[1]))) {
            candidates.push({ url: `https://www.linkedin.com/in/${match[1]}/`, name: rawName, company });
          }
        }
      } catch {}
    }
  }

  if (candidates.length > 0) return candidates;

  // Paso 3: Fallback X-Ray para la empresa y socios en la ubicación solicitada
  if (budget && budget.searchesUsed >= budget.maxSearches) {
    return candidates;
  }
  if (budget) {
    budget.searchesUsed++;
    await sleep(SERPER_COURTESY_DELAY_MS);
  }

  const titleTokens = titles.map((title) => `"${title}"`).join(" OR ");
  let xray = await web.search({
    query: locationFilter
      ? `site:linkedin.com/in/ (${titleTokens}) "${company}" ${locationFilter}`
      : `site:linkedin.com/in/ (${titleTokens}) "${company}"`,
    country: locCode,
    language: lang,
    limit: Math.min(10, context.limit),
  });

  if (xray.items.length === 0 && locationFilter && (!budget || budget.searchesUsed < budget.maxSearches)) {
    if (budget) {
      budget.searchesUsed++;
      await sleep(SERPER_COURTESY_DELAY_MS);
    }
    xray = await web.search({
      query: `site:linkedin.com/in/ (${titleTokens}) "${company}"`,
      country: locCode,
      language: lang,
      limit: Math.min(10, context.limit),
    });
  }

  for (const result of xray.items) {
    try {
      const url = new URL(result.link);
      const match = url.pathname.match(/\/in\/([^/]+)/i);
      if (!match) continue;
      const rawName = result.title.replace(/\s*[-|].*$/, "").trim();
      if (rawName && !candidates.some((c) => c.url.includes(match[1]))) {
        candidates.push({ url: `https://www.linkedin.com/in/${match[1]}/`, name: rawName, company });
      }
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
  // Serper free tier limita a un máximo de 10 resultados para consultas booleanas complejas
  const articleLimit = Math.min(10, Math.max(5, context.limit));
  const effectiveWindowDays = context.icp.time_window_days && context.icp.time_window_days > 30
    ? context.icp.time_window_days
    : (context.monitor.type === "funding_round" ? 180 : (context.icp.time_window_days || 60));

  const country = locationCode(context.icp);
  const language = searchLanguage(country);
  const isNewsQuery = ["funding_round", "company_news", "acquisition_event", "industry_event"].includes(context.monitor.type)
    || (context.icp.event_kinds && context.icp.event_kinds.some((k) => ["funding_round", "company_news", "acquisition_event", "industry_event"].includes(k)));
  const searchFn = isNewsQuery && typeof (web as any).searchNews === "function"
    ? (web as any).searchNews.bind(web)
    : web.search.bind(web);
  const response = await searchFn({
    query,
    country,
    language,
    limit: articleLimit,
    timeRange: timeRange(effectiveWindowDays),
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
    const namedFounders = extractFoundersFromArticle(`${article.title} ${article.snippet || ""}`);
    let people: Awaited<ReturnType<typeof findPeople>>;
    try { people = await findPeople(linkedIn, web, context, company, locationIds, budget, namedFounders); }
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
          || companyMatches(inferredFromHeadline, company);

        if (!companyVerified) continue;
        const headline = profile.headline || current?.position || null;
        if (!titleMatches(headline, context.icp.titles || [], context.monitor.type)) continue;
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
