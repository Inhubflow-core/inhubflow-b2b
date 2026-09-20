import type { BrowserContext, Page } from "playwright";
import type DatabaseType from "better-sqlite3";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionPage, markNeedsReauth } from "@/lib/linkedin/session";
import { resolveOrCreateCompany, linkTargetToCompany, extractDomain } from "@/lib/companies/service";

type DB = DatabaseType.Database;

export interface SearchLead {
  linkedinUrl: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  email?: string | null;
  phone?: string | null;
  profileImageUrl: string | null;
  degree: number | null;
  summary: string | null;
}

export interface SearchFilters {
  title?: string;
  location?: string;
  company?: string;
  keywords?: string;
}

export interface SearchOptions {
  accountId: string;
  filters: SearchFilters;
  limit?: number;
  listName?: string;
}

export interface SearchProgressEvent {
  phase: "starting" | "navigating" | "scrolling" | "extracting" | "saving" | "completed" | "error";
  page: number;
  totalPages: number;
  totalFound: number;
  currentLead?: SearchLead;
  message?: string;
}

export type SearchProgressCallback = (event: SearchProgressEvent) => void;

const STOP_WORDS = new Set([
  "de", "del", "la", "las", "el", "los", "en", "y", "e", "para", "por", "con", "un", "una", "unos", "unas",
  "da", "do", "das", "dos", "em", "um", "uma", "com",
  "of", "in", "the", "and", "for", "with", "a", "an", "at", "to", "or"
]);

const PLURAL_MAP: Record<string, string> = {
  agencias: "agencia",
  agências: "agência",
  empresas: "empresa",
  consultorias: "consultoria",
  consultorías: "consultoría",
  inmobiliarias: "inmobiliaria",
  imobiliarias: "imobiliária",
  clinicas: "clinica",
  clínicas: "clínica",
  hospitales: "hospital",
  hospitais: "hospital",
  abogados: "abogado",
  advogados: "advogado",
  dentistas: "dentista",
  desarrolladores: "desarrollador",
  desenvolvedores: "desenvolvedor",
  directores: "director",
  diretores: "diretor",
  gerentes: "gerente",
  socios: "socio",
  sócios: "sócio",
};

/**
 * Tokenize and normalize words, eliminating stop words and converting common plurals to singular.
 */
export function cleanTokens(text: string): string[] {
  if (!text) return [];
  return text
    .replace(/[,;":.?¿!¡#+()/*\\&]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .map((word) => PLURAL_MAP[word] || word)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

/**
 * Clean words from punctuation so LinkedIn search tokens match naturally.
 */
function sanitizeTerm(term: string): string {
  const tokens = cleanTokens(term);
  return tokens.join(" ");
}

const INDUSTRY_EXPANSIONS: Record<string, string[]> = {
  // Minería / Mining
  mineria: ["Minería", "Minera", "Minero", "Mining"],
  minera: ["Minería", "Minera", "Minero", "Mining"],
  mining: ["Mining", "Minería", "Minera"],

  // Marketing & Publicidad / Agencias
  marketing: ["Marketing", "Agencia", "Agência", "Publicidad", "Digital"],
  agencia: ["Agencia", "Agência", "Marketing", "Advertising", "Digital"],
  agencias: ["Agencia", "Agência", "Marketing", "Advertising", "Digital"],
  publicidad: ["Publicidad", "Advertising", "Marketing", "Agencia"],

  // Software & Tecnología / SaaS
  saas: ["SaaS", "Software", "Tech", "Tecnologia", "Cloud"],
  software: ["Software", "SaaS", "Tech", "Tecnologia", "TI"],
  tech: ["Tech", "Tecnología", "Tecnologia", "Software", "SaaS"],
  tecnologia: ["Tecnología", "Tecnologia", "Software", "Tech", "SaaS"],
  ia: ["IA", "AI", '"Inteligencia Artificial"', '"Machine Learning"'],
  ai: ["AI", "IA", '"Artificial Intelligence"', '"Machine Learning"'],

  // Salud & Farmacia
  salud: ["Salud", "Saúde", "Médica", "Médico", "Clínica", "Hospital", "Healthcare"],
  saude: ["Saúde", "Salud", "Médica", "Médico", "Clínica", "Hospital", "Healthcare"],
  medica: ["Médica", "Médico", "Salud", "Clínica", "Hospital"],
  clinica: ["Clínica", "Salud", "Hospital", "Médica"],
  hospital: ["Hospital", "Salud", "Clínica", "Healthcare"],
  farmaceutica: ["Farmacéutica", "Farmacêutica", "Pharma", "Laboratorio"],

  // Inmobiliaria & Construcción
  inmobiliaria: ["Inmobiliaria", "Imobiliária", '"Real Estate"', "Propiedades"],
  imobiliaria: ["Imobiliária", "Inmobiliaria", '"Real Estate"', "Propriedades"],
  construccion: ["Construcción", "Construção", "Construction", "Obras", "Edificación"],
  construcao: ["Construção", "Construcción", "Construction", "Obras"],

  // Finanzas & Fintech
  fintech: ["Fintech", "Finanzas", "Finanças", "Banca", "Banking", "Finance"],
  finanzas: ["Finanzas", "Finanças", "Finance", "Banca", "Inversiones"],
  financas: ["Finanças", "Finanzas", "Finance", "Bancos", "Investimentos"],
  banca: ["Banca", "Banking", "Finanzas", "Banco"],

  // Logística & Transporte
  logistica: ["Logística", "Logistics", "Transporte", '"Supply Chain"', "Operaciones"],
  transporte: ["Transporte", "Logística", "Transportes", "Freight"],

  // Legal
  legal: ["Legal", "Abogados", "Advogados", "Jurídico", "Law"],
  abogados: ["Abogado", "Abogados", "Advogado", "Advogados", "Legal", "Derecho"],
  advogados: ["Advogado", "Advogados", "Abogado", "Legal", "Direito"],

  // Recursos Humanos
  rrhh: ["RRHH", '"Recursos Humanos"', "RH", "HR", '"Talent Acquisition"'],
  rh: ["RH", "RRHH", '"Recursos Humanos"', "HR"],

  // Retail & E-commerce
  ecommerce: ["E-commerce", "Ecommerce", '"Comercio Electrónico"', "Retail"],
  retail: ["Retail", "Comercio", "Varejo", "E-commerce"],

  // Alimentos & Agro
  agro: ["Agro", "Agrícola", "Agricultura", "Agribusiness", "Agropecuaria"],
  agricola: ["Agrícola", "Agro", "Agricultura", "Agribusiness"],
  alimentos: ["Alimentos", "Food", '"Food & Beverage"', "Bebidas", "Alimentaria"],
};

const TITLE_EXPANSIONS: Record<string, string[]> = {
  ceo: ["CEO", "Founder", "Fundador", '"Director General"', '"Gerente General"', '"Diretor Geral"'],
  ceos: ["CEO", "Founder", "Fundador", '"Director General"', '"Gerente General"'],
  director: ["Director", "Directora", "Directores", "Diretor", "Diretora", "Head", "VP"],
  directores: ["Director", "Directores", "Diretor", "Diretores", "Head", "VP"],
  diretor: ["Diretor", "Diretora", "Diretores", "Director", "Head", "VP"],
  diretores: ["Diretor", "Diretores", "Director", "Directores", "Head", "VP"],
  founder: ["Founder", '"Co-Founder"', "Fundador", "CEO"],
  fundador: ["Fundador", "Founder", '"Co-Founder"', "CEO"],
  gerente: ["Gerente", "Manager", "Head", '"Gerente General"'],
  comercial: ["Comercial", "Ventas", "Vendas", "Sales", '"Business Development"'],
  ventas: ["Ventas", "Vendas", "Sales", "Comercial"],
  vendas: ["Vendas", "Ventas", "Sales", "Comercial"],
  abogado: ["Abogado", "Abogados", "Advogado", "Advogados", "Legal"],
  advogado: ["Advogado", "Advogados", "Abogado", "Abogados", "Legal"],
  dentista: ["Dentista", "Odontólogo", "Odontologista", "Dentistry"],
  odontologo: ["Odontólogo", "Dentista", "Odontologia"],
};

const COUNTRY_WORDS = new Set([
  "brasil", "brazil", "chile", "espana", "españa", "spain", "colombia", "mexico", "méxico", "argentina", "peru", "perú", "uruguay", "usa", "eeuu"
]);

const LINKEDIN_GEO_URNS: Record<string, string> = {
  // Chile
  chile: "104621610",
  santiago: "105741643",
  valparaiso: "104621610",
  concepcion: "104621610",

  // Brasil
  brasil: "106057199",
  brazil: "106057199",
  "sao paulo": "104746682",
  "são paulo": "104746682",
  "rio de janeiro": "106057199",
  "belo horizonte": "106057199",
  curitiba: "106057199",

  // Peru
  peru: "102927786",
  perú: "102927786",
  lima: "105333783",

  // Colombia
  colombia: "100876405",
  bogota: "101784918",
  bogotá: "101784918",
  medellin: "100876405",
  medellín: "100876405",
  cali: "100876405",

  // España
  espana: "105646813",
  españa: "105646813",
  spain: "105646813",
  madrid: "100878084",
  barcelona: "105646813",
  valencia: "105646813",

  // Mexico
  mexico: "103323778",
  méxico: "103323778",
  "ciudad de mexico": "103323778",
  "ciudad de méxico": "103323778",
  cdmx: "103323778",
  monterrey: "103323778",
  guadalajara: "103323778",

  // Argentina
  argentina: "100446943",
  "buenos aires": "100446943",
  cordoba: "100446943",

  // USA
  usa: "103644278",
  "estados unidos": "103644278",
  "united states": "103644278",
  miami: "103644278",
  florida: "103644278",
  "new york": "103644278",
  california: "103644278",
};

export function resolveGeoUrn(loc: string): string | null {
  if (!loc) return null;
  const clean = loc.toLowerCase().replace(/[,.;:/\\-]/g, " ").trim();
  for (const [key, urn] of Object.entries(LINKEDIN_GEO_URNS)) {
    if (clean.includes(key)) {
      return urn;
    }
  }
  return null;
}

/**
 * Expands a single user token or term using the dictionary.
 */
function expandTerm(term: string, expansionDict: Record<string, string[]>): string[] {
  const clean = term.trim().toLowerCase();
  if (!clean) return [];
  const expanded = expansionDict[clean];
  if (expanded && expanded.length > 0) {
    // Strip quotes and return clean words
    return expanded.map((e) => e.replace(/["()]/g, "").trim()).filter(Boolean);
  }
  const cap = clean.length > 3 ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean.toUpperCase();
  return [cap];
}

/**
 * Builds prioritized, clean keyword combinations for LinkedIn search without broken boolean syntax.
 * Example for Titles: ["CEO", "Director"], Industry: "Inmobiliaria", Location: "Santiago, Chile":
 * 1. "CEO Inmobiliaria Santiago"
 * 2. "Director Inmobiliaria Santiago"
 * 3. "CEO Inmobiliaria Chile"
 * 4. "Director Inmobiliaria Chile"
 * 5. "Gerente Inmobiliaria Santiago"
 * 6. "Inmobiliaria Santiago"
 * 7. "CEO Santiago"
 * 8. "Director Santiago"
 */
export function buildQueryVariants(filters: SearchFilters): string[] {
  const rawTitles = (filters.title || "")
    .split(/[,;/|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const titleTokens = cleanTokens(filters.title || "");

  const rawCompanies = (filters.company || "")
    .split(/[,;/|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const compTokens = cleanTokens(filters.company || "");

  const locTokens = cleanTokens(filters.location || "");
  const kwTokens = cleanTokens(filters.keywords || "");

  // City vs Country
  const locCityOnly = locTokens.filter((t) => !COUNTRY_WORDS.has(t));
  const cityStr = locCityOnly.length > 0 ? locCityOnly.join(" ") : "";
  const fullLocStr = locTokens.join(" ");

  // Expand titles and industries into clean words
  const titlesList: string[] = [];
  const inputTitles = rawTitles.length > 0 ? rawTitles : titleTokens;
  for (const t of inputTitles) {
    const ex = expandTerm(t, TITLE_EXPANSIONS);
    for (const word of ex) {
      if (!titlesList.includes(word)) titlesList.push(word);
    }
  }
  if (titlesList.length === 0 && titleTokens.length > 0) {
    titlesList.push(titleTokens.join(" "));
  }

  const industryList: string[] = [];
  const inputCompanies = rawCompanies.length > 0 ? rawCompanies : compTokens;
  for (const c of inputCompanies) {
    const ex = expandTerm(c, INDUSTRY_EXPANSIONS);
    for (const word of ex) {
      if (!industryList.includes(word)) industryList.push(word);
    }
  }
  if (industryList.length === 0 && compTokens.length > 0) {
    industryList.push(compTokens.join(" "));
  }

  const variants: string[] = [];
  const add = (parts: Array<string | undefined | null>) => {
    const cleanStr = parts
      .filter(Boolean)
      .join(" ")
      .replace(/[,;":.?¿!¡#+()/*\\&]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleanStr && !variants.includes(cleanStr)) {
      variants.push(cleanStr);
    }
  };

  const kwStr = kwTokens.length > 0 ? kwTokens.join(" ") : null;

  // Tier 1: Title + Industry + City (Most Specific & Exact ICP)
  if (titlesList.length > 0 && industryList.length > 0 && cityStr) {
    for (const t of titlesList.slice(0, 3)) {
      for (const ind of industryList.slice(0, 2)) {
        add([t, ind, cityStr, kwStr]);
      }
    }
  }

  // Tier 2: Title + Industry + Full Location (Country level fallback)
  if (titlesList.length > 0 && industryList.length > 0 && fullLocStr && fullLocStr !== cityStr) {
    for (const t of titlesList.slice(0, 2)) {
      for (const ind of industryList.slice(0, 2)) {
        add([t, ind, fullLocStr, kwStr]);
      }
    }
  }

  // Tier 3: Title + City (Broad baseline)
  if (titlesList.length > 0 && cityStr) {
    for (const t of titlesList.slice(0, 3)) {
      add([t, cityStr, kwStr]);
    }
  }

  // Tier 4: Title + Full Location
  if (titlesList.length > 0 && fullLocStr && fullLocStr !== cityStr) {
    for (const t of titlesList.slice(0, 2)) {
      add([t, fullLocStr, kwStr]);
    }
  }

  // Tier 5: Industry + Location (if title was too restrictive)
  if (industryList.length > 0 && (cityStr || fullLocStr)) {
    for (const ind of industryList.slice(0, 2)) {
      add([ind, cityStr || fullLocStr, kwStr]);
    }
  }

  // Tier 6: Just Titles or Keywords
  if (titlesList.length > 0) {
    for (const t of titlesList.slice(0, 2)) {
      add([t, kwStr]);
    }
  }

  return variants.length > 0 ? variants : ["CEO"];
}

/**
 * Builds the primary search query string.
 */
export function buildSearchQuery(filters: SearchFilters): string {
  const variants = buildQueryVariants(filters);
  return variants[0] || "CEO";
}

/**
 * Clean & normalize LinkedIn profile URL.
 */
function normalizeProfileUrl(raw: string): string | null {
  if (!raw || !raw.includes("linkedin.com/in/")) return null;
  try {
    const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (
      !pathname.startsWith("/in/") ||
      pathname === "/in/unavailable" ||
      pathname === "/in/" ||
      pathname.includes("/edit/") ||
      pathname.includes("/detail/")
    ) {
      return null;
    }
    return `https://www.linkedin.com${pathname}/`;
  } catch {
    const match = raw.match(/(https?:\/\/[a-z]{2,3}\.linkedin\.com\/in\/[^/?#]+)/i);
    return match ? `${match[1].replace(/\/+$/, "")}/` : null;
  }
}

/**
 * Parses full name into first and last name components.
 */
export function parseName(fullName: string | null): { firstName: string | null; lastName: string | null } {
  if (!fullName) return { firstName: null, lastName: null };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

/**
 * Universal cleaner and de-duplicator for LinkedIn card strings.
 * Dissects composite strings (e.g. "Jose Felix Hurtado Cruz Jose Felix Hurtado Cruz • 3º e +Ceo & Cofundador...")
 * into pure FullName, FirstName, LastName, Title/Headline, Company, and Location.
 */
export function cleanProfileCardText(
  rawNameInput: string | null,
  rawHeadlineInput?: string | null,
  rawLocationInput?: string | null
): {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  location: string | null;
  company: string | null;
} {
  let rawName = (rawNameInput || "").trim();
  let title = (rawHeadlineInput || "").trim() || null;
  let location = (rawLocationInput || "").trim() || null;
  let company: string | null = null;

  if (!rawName) {
    return {
      fullName: "Prospecto de LinkedIn",
      firstName: null,
      lastName: null,
      title,
      location,
      company,
    };
  }

  // 1. If rawName contains LinkedIn degree separator " • " or degree badges
  if (rawName.includes("•")) {
    const parts = rawName.split(/\s*•\s*/);
    rawName = parts[0].trim();

    if (parts.length > 1 && (!title || !location)) {
      const rest = parts.slice(1).join(" ");
      const cleanRest = rest.replace(/^\d+(?:º|st|nd|rd|th)?(?:\s+e\s+|\s+y\s+|\s+and\s+|\s+)?/i, "").trim();

      const actionMatch = cleanRest.match(/(?:Mensagem|Conectar|Seguir|Message|Connect|Follow|Enviar mensagem|Acesse meu site|Atual:|Current:|Anterior:)/i);
      let candidateTitle = cleanRest;
      if (actionMatch && actionMatch.index !== undefined) {
        candidateTitle = cleanRest.slice(0, actionMatch.index).trim();
      }

      candidateTitle = candidateTitle.replace(/^\+\s*/, "").trim();
      if (!title && candidateTitle) {
        title = candidateTitle;
      }
    }
  }

  // 2. Remove common trailing garbage & pronouns
  rawName = rawName
    .replace(/\s*\|\s*LinkedIn.*$/i, "")
    .replace(/\s*-\s*LinkedIn.*$/i, "")
    .replace(/\s*[-–—]\s*(?:CEO|Director|Gerente|Founder|Presidente|COO|CFO|CTO|Manager|Head).*$/i, "")
    .replace(/\s*\(\s*(?:él|ella|he\/him|she\/her|they\/them|ella\/she)\s*\)/i, "")
    .replace(/\s*(?:,?\s*(?:Ph\.?D\.?|MSc|MBA|PMP®?|CPA|MD|Eng|Ing|Dr|Dra))\b.*$/i, "")
    .trim();

  // 3. Detect and fix duplicated repeated names
  const words = rawName.split(/\s+/);
  if (words.length >= 2 && words.length % 2 === 0) {
    const half = words.length / 2;
    const firstHalf = words.slice(0, half).join(" ");
    const secondHalf = words.slice(half).join(" ");
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      rawName = firstHalf;
    }
  } else if (words.length >= 4) {
    for (let h = Math.floor(words.length / 2); h >= 2; h--) {
      const first = words.slice(0, h).join(" ");
      const second = words.slice(h, h * 2).join(" ");
      if (first.toLowerCase() === second.toLowerCase()) {
        rawName = first;
        break;
      }
    }
  }

  if (rawName.includes("\n")) {
    rawName = rawName.split("\n").map((s) => s.trim()).filter(Boolean)[0] || rawName;
  }

  // 4. Clean title / headline
  if (title) {
    title = title
      .replace(/^\+\s*/, "")
      .replace(/\s*\|\s*LinkedIn.*$/i, "")
      .replace(/\s*(?:Mensagem|Conectar|Seguir|Message|Connect|Follow).*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    const compMatch = title.match(/(?:at|en|@|\|)\s+([^,|•\n]+)/i);
    if (compMatch) {
      company = compMatch[1].trim();
    }
  }

  const nameTokens = rawName.split(/\s+/);
  const firstName = nameTokens[0] || null;
  const lastName = nameTokens.slice(1).join(" ") || null;

  return {
    fullName: rawName || "Prospecto de LinkedIn",
    firstName,
    lastName,
    title: title || null,
    location: location || null,
    company: company || null,
  };
}

/**
 * Try to extract company name from headline string if not present as a separate field.
 */
function extractCompanyFromHeadline(headline: string | null): string | null {
  if (!headline) return null;
  const match = headline.match(/(?:at|en|@|\|)\s+([^,|•\n]+)/i);
  return match ? match[1].trim() : null;
}

/**
 * Extracts vector image URL from LinkedIn Voyager image representation.
 */
function resolveVectorImage(vectorImage: unknown): string | null {
  if (!vectorImage || typeof vectorImage !== "object") return null;
  const vi = vectorImage as { rootUrl?: string; artifacts?: Array<{ fileIdentifyingUrlPathSegment?: string }> };
  if (vi.rootUrl && vi.artifacts && vi.artifacts.length > 0) {
    const lastArtifact = vi.artifacts[vi.artifacts.length - 1];
    if (lastArtifact?.fileIdentifyingUrlPathSegment) {
      return `${vi.rootUrl}${lastArtifact.fileIdentifyingUrlPathSegment}`;
    }
  }
  return null;
}

/**
 * Direct Voyager Search API fetch via page context (inherits session cookies & CSRF token).
 */
async function fetchVoyagerSearchPage(
  page: Page,
  keywords: string,
  start: number,
  count: number = 10
): Promise<SearchLead[] | null> {
  return page.evaluate(
    async ({ keywords, start, count }): Promise<SearchLead[] | null> => {
      const cookies = document.cookie.split("; ").reduce((a: Record<string, string>, c) => {
        const i = c.indexOf("=");
        if (i > 0) a[c.slice(0, i)] = c.slice(i + 1);
        return a;
      }, {});
      const csrf = (cookies["JSESSIONID"] || "").replace(/"/g, "");

      const url =
        `https://www.linkedin.com/voyager/api/search/dash/clusters` +
        `?decorationId=com.linkedin.voyager.dash.deco.search.SearchClusterCollection-194` +
        `&origin=GLOBAL_SEARCH_HEADER&q=all` +
        `&query=(keywords:${encodeURIComponent(keywords)})` +
        `&start=${start}&count=${count}`;

      try {
        const r = await fetch(url, {
          headers: {
            "csrf-token": csrf,
            accept: "application/vnd.linkedin.normalized+json+2.1",
            "x-restli-protocol-version": "2.0.0",
            "x-li-lang": "en_US",
          },
          credentials: "include",
        });

        if (!r.ok) return null;
        const json = (await r.json()) as {
          included?: Array<Record<string, unknown>>;
          data?: Record<string, unknown>;
        };

        const included = json.included || [];
        const leads: SearchLead[] = [];

        for (const item of included) {
          const type = (item.$type as string) || "";
          if (type.includes("EntityResultViewModel")) {
            const titleObj = item.title as { text?: string } | undefined;
            const primarySubtitleObj = item.primarySubtitle as { text?: string } | undefined;
            const secondarySubtitleObj = item.secondarySubtitle as { text?: string } | undefined;
            const summaryObj = item.summary as { text?: string } | undefined;
            const navUrl = (item.navigationUrl as string) || "";
            const badgeText = (item.badgeText as string) || "";

            if (navUrl && navUrl.includes("linkedin.com/in/")) {
              const fullName = titleObj?.text?.trim() || "Prospecto de LinkedIn";
              const title = primarySubtitleObj?.text?.trim() || null;
              const location = secondarySubtitleObj?.text?.trim() || null;
              const summary = summaryObj?.text?.trim() || null;

              let degree: number | null = null;
              if (badgeText) {
                if (/1st|1\.º/i.test(badgeText)) degree = 1;
                else if (/2nd|2\.º/i.test(badgeText)) degree = 2;
                else if (/3rd|3\.º/i.test(badgeText)) degree = 3;
              }

              // Extract image if available
              let profileImageUrl: string | null = null;
              const imgObj = item.image as {
                attributes?: Array<{
                  detailData?: {
                    nonEntityProfilePicture?: { vectorImage?: unknown };
                  };
                }>;
              } | undefined;
              const vi = imgObj?.attributes?.[0]?.detailData?.nonEntityProfilePicture?.vectorImage;
              if (vi) {
                // @ts-expect-error in-browser vector parsing
                if (vi.rootUrl && vi.artifacts?.length) {
                  // @ts-expect-error in-browser vector parsing
                  profileImageUrl = `${vi.rootUrl}${vi.artifacts[vi.artifacts.length - 1].fileIdentifyingUrlPathSegment}`;
                }
              }

              const parts = fullName.split(/\s+/);
              const firstName = parts[0] || null;
              const lastName = parts.slice(1).join(" ") || null;

              leads.push({
                linkedinUrl: navUrl.split("?")[0].replace(/\/+$/, "") + "/",
                fullName,
                firstName,
                lastName,
                title,
                company: null,
                location,
                profileImageUrl,
                degree,
                summary,
              });
            }
          }
        }

        return leads;
      } catch {
        return null;
      }
    },
    { keywords, start, count }
  );
}

/**
 * Executes a LinkedIn people search using the account's stealth browser context,
 * employing Voyager API, Network Interception, and DOM Extraction with virtual scrolling.
 */
export async function searchLinkedInProfiles(
  options: SearchOptions,
  onProgress?: SearchProgressCallback
): Promise<SearchLead[]> {
  const { accountId, filters, limit = 25 } = options;
  const queryVariants = buildQueryVariants(filters);

  if (queryVariants.length === 0) {
    throw new Error("Debes proporcionar al menos un filtro de búsqueda (Cargo, Ubicación o Palabras Clave).");
  }

  const db = getDb();
  const account = db.prepare("SELECT id, name, is_authenticated FROM accounts WHERE id = ?").get(accountId) as
    | { id: string; name: string; is_authenticated: number }
    | undefined;

  if (!account) {
    throw new Error(`Cuenta con ID ${accountId} no encontrada.`);
  }

  if (!account.is_authenticated) {
    throw new Error(`La cuenta ${account.name} no está autenticada. Inicia sesión en Ajustes primero.`);
  }

  const estimatedPages = Math.min(Math.ceil(limit / 10), 10);
  const collectedLeads: SearchLead[] = [];
  const seenUrls = new Set<string>();

  onProgress?.({
    phase: "starting",
    page: 1,
    totalPages: estimatedPages,
    totalFound: 0,
    message: `Iniciando búsqueda para: "${queryVariants[0]}"...`,
  });

  const page = await getSessionPage(accountId);

  // Network interception buffer for Voyager responses
  const networkLeads: SearchLead[] = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (
      (url.includes("voyager/api/search/dash/clusters") || url.includes("voyager/api/graphql")) &&
      response.status() === 200
    ) {
      try {
        const json = (await response.json()) as { included?: Array<Record<string, unknown>> };
        const included = json?.included || [];
        for (const item of included) {
          const type = (item?.$type as string) || "";
          if (type.includes("EntityResultViewModel")) {
            const titleObj = item.title as { text?: string } | undefined;
            const primarySubtitleObj = item.primarySubtitle as { text?: string } | undefined;
            const secondarySubtitleObj = item.secondarySubtitle as { text?: string } | undefined;
            const summaryObj = item.summary as { text?: string } | undefined;
            const navUrl = (item.navigationUrl as string) || "";
            const badgeText = (item.badgeText as string) || "";

            if (navUrl && navUrl.includes("linkedin.com/in/")) {
              const cleanUrl = normalizeProfileUrl(navUrl);
              if (!cleanUrl) continue;

              const fullName = titleObj?.text?.trim() || "Prospecto de LinkedIn";
              const { firstName, lastName } = parseName(fullName);
              const title = primarySubtitleObj?.text?.trim() || null;
              const location = secondarySubtitleObj?.text?.trim() || null;
              const summary = summaryObj?.text?.trim() || null;

              let degree: number | null = null;
              if (badgeText) {
                if (/1st|1\.º/i.test(badgeText)) degree = 1;
                else if (/2nd|2\.º/i.test(badgeText)) degree = 2;
                else if (/3rd|3\.º/i.test(badgeText)) degree = 3;
              }

              networkLeads.push({
                linkedinUrl: cleanUrl,
                fullName,
                firstName,
                lastName,
                title,
                company: extractCompanyFromHeadline(title),
                location,
                profileImageUrl: null,
                degree,
                summary,
              });
            }
          }
        }
      } catch {
        /* ignore parse errors */
      }
    }
  });

  try {
    for (let variantIndex = 0; variantIndex < queryVariants.length; variantIndex++) {
      if (collectedLeads.length >= limit) break;

      const currentQuery = queryVariants[variantIndex];
      const isFallbackVariant = variantIndex > 0;

      if (isFallbackVariant) {
        onProgress?.({
          phase: "navigating",
          page: 1,
          totalPages: estimatedPages,
          totalFound: collectedLeads.length,
          message: `Ampliando términos de búsqueda para encontrar más prospectos: "${currentQuery}"...`,
        });
      }

      for (let pageNum = 1; pageNum <= estimatedPages; pageNum++) {
        if (collectedLeads.length >= limit) break;

        const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
          currentQuery
        )}&origin=GLOBAL_SEARCH_HEADER&page=${pageNum}`;

        onProgress?.({
          phase: "navigating",
          page: pageNum,
          totalPages: estimatedPages,
          totalFound: collectedLeads.length,
          message: `Escaneando página ${pageNum} de ${estimatedPages} ("${currentQuery}")...`,
        });

        await page.goto(searchUrl, {
          waitUntil: "domcontentloaded",
          timeout: 35000,
        });

        // Check for authwall / login wall
        const currentUrl = page.url();
        if (/\/login|\/authwall|\/checkpoint|\/uas\//.test(currentUrl)) {
          await markNeedsReauth(accountId);
          throw new Error(
            `La sesión de LinkedIn se ha cerrado o requiere verificación (${currentUrl}). Por favor re-autentica tu cuenta en Ajustes.`
          );
        }

        // Wait for React SPA hydration and search results network traffic
        await page.waitForTimeout(2500 + Math.random() * 1000);

        // ─── TIER 1: In-Page Voyager API ─────────────────────────────────────────
        try {
          const startOffset = (pageNum - 1) * 10;
          const apiResults = await fetchVoyagerSearchPage(page, currentQuery, startOffset, 10);
          if (apiResults && apiResults.length > 0) {
            for (const item of apiResults) {
              if (collectedLeads.length >= limit) break;
              const cleanUrl = normalizeProfileUrl(item.linkedinUrl);
              if (!cleanUrl || seenUrls.has(cleanUrl)) continue;

              seenUrls.add(cleanUrl);
              const lead: SearchLead = {
                ...item,
                linkedinUrl: cleanUrl,
                company: filters.company?.trim() || extractCompanyFromHeadline(item.title),
              };
              collectedLeads.push(lead);

              onProgress?.({
                phase: "extracting",
                page: pageNum,
                totalPages: estimatedPages,
                totalFound: collectedLeads.length,
                currentLead: lead,
                message: `[Voyager API] Prospecto captado: ${lead.fullName} (${lead.title || "Sin cargo"})`,
              });
            }
          }
        } catch (err) {
          console.warn("[search] Voyager API fetch notice:", err);
        }

        // ─── TIER 2: Intercepted Network Responses ──────────────────────────────
        if (networkLeads.length > 0) {
          for (const item of networkLeads) {
            if (collectedLeads.length >= limit) break;
            if (seenUrls.has(item.linkedinUrl)) continue;

            seenUrls.add(item.linkedinUrl);
            const lead: SearchLead = {
              ...item,
              company: filters.company?.trim() || item.company,
            };
            collectedLeads.push(lead);

            onProgress?.({
              phase: "extracting",
              page: pageNum,
              totalPages: estimatedPages,
              totalFound: collectedLeads.length,
              currentLead: lead,
              message: `[Network] Prospecto captado: ${lead.fullName}`,
            });
          }
          networkLeads.length = 0;
        }

        // If we already collected enough leads, proceed or break
        if (collectedLeads.length >= limit) break;

        // ─── TIER 3: DOM Rendering & Progressive Scroll Extraction ──────────────
        try {
          await page.waitForSelector(
            "a[href*='/in/'], .search-results-container, div[data-view-name*='search'], li.reusable-search__result-container, div.entity-result",
            { timeout: 6000 }
          );
        } catch {
          /* continue to evaluate whatever is rendered */
        }

        onProgress?.({
          phase: "scrolling",
          page: pageNum,
          totalPages: estimatedPages,
          totalFound: collectedLeads.length,
          message: `Desplazando página ${pageNum} para cargar perfiles y fotos...`,
        });

        // Smooth scroll to load dynamic elements
        await page.evaluate(async () => {
          const totalHeight = document.body.scrollHeight;
          const step = 400;
          let pos = 0;
          while (pos < totalHeight) {
            window.scrollBy(0, step);
            pos += step;
            await new Promise((r) => setTimeout(r, 150));
          }
        });

        await page.waitForTimeout(1000 + Math.random() * 500);

        // Extract leads from DOM
        const extractedRaw = await page.evaluate(() => {
          const items: Array<{
            rawUrl: string | null;
            rawName: string | null;
            rawHeadline: string | null;
            rawLocation: string | null;
            rawImage: string | null;
            rawDegree: string | null;
            rawSummary: string | null;
          }> = [];

          const allLinks = Array.from(document.querySelectorAll("a[href*='/in/']")) as HTMLAnchorElement[];
          const seenCardUrls = new Set<string>();

          for (const a of allLinks) {
            const rawUrl = a.href || "";
            if (!rawUrl.includes("/in/")) continue;
            const cleanPath = rawUrl.split("?")[0].split("#")[0].replace(/\/+$/, "");
            if (
              cleanPath.endsWith("/in") ||
              cleanPath.includes("/in/me") ||
              cleanPath.includes("/in/unavailable") ||
              cleanPath.includes("/in/edit") ||
              seenCardUrls.has(cleanPath)
            ) {
              continue;
            }
            seenCardUrls.add(cleanPath);

            const card =
              a.closest("li") ||
              a.closest("div.entity-result") ||
              a.closest("div[data-view-name*='search']") ||
              a.closest("div[data-chameleon-result-urn]") ||
              a.parentElement?.parentElement ||
              a;

            // Name
            let rawName: string | null = null;
            const nameEl =
              card.querySelector("span.entity-result__title-text a span[aria-hidden='true']") ||
              card.querySelector("a[href*='/in/'] span[aria-hidden='true']") ||
              card.querySelector(".entity-result__title-text a") ||
              a.querySelector("span[aria-hidden='true']") ||
              a;

            if (nameEl) {
              rawName = nameEl.textContent?.trim() || null;
            }

            // Headline / Title
            const headlineEl =
              card.querySelector(".entity-result__primary-subtitle") ||
              card.querySelector("div[data-view-name*='search'] .entity-result__primary-subtitle") ||
              card.querySelector("div.t-14.t-black.t-normal") ||
              card.querySelector("div.t-14.t-normal") ||
              card.querySelector("p.entity-result__summary") ||
              card.querySelector(".entity-result__summary");
            const rawHeadline = headlineEl ? headlineEl.textContent?.trim() || null : null;

            // Location
            const locEl =
              card.querySelector(".entity-result__secondary-subtitle") ||
              card.querySelector("div[data-view-name*='search'] .entity-result__secondary-subtitle") ||
              card.querySelector("div.t-12.t-normal") ||
              card.querySelector("div.t-black--light");
            const rawLocation = locEl ? locEl.textContent?.trim() || null : null;

            // Avatar Image
            const imgEl =
              (card.querySelector("img[src*='licdn.com']") as HTMLImageElement | null) ||
              (card.querySelector("img.presence-entity__image") as HTMLImageElement | null) ||
              (card.querySelector("img.evi-image") as HTMLImageElement | null) ||
              (card.querySelector("img") as HTMLImageElement | null);
            const rawImage = imgEl ? imgEl.src : null;

            // Degree
            const badgeEl =
              card.querySelector(".entity-result__badge-text") ||
              card.querySelector("span.dist-value") ||
              card.querySelector("span.artdeco-badge__text");
            const rawDegree = badgeEl ? badgeEl.textContent?.trim() || null : null;

            items.push({
              rawUrl,
              rawName,
              rawHeadline,
              rawLocation,
              rawImage,
              rawDegree,
              rawSummary: null,
            });
          }

          return items;
        });

        for (const item of extractedRaw) {
          if (collectedLeads.length >= limit) break;
          if (!item.rawUrl) continue;

          const cleanUrl = normalizeProfileUrl(item.rawUrl);
          if (!cleanUrl || seenUrls.has(cleanUrl)) continue;

          seenUrls.add(cleanUrl);

          const {
            fullName: cleanName,
            firstName,
            lastName,
            title: cleanTitle,
            location: cleanLocation,
            company: autoComp,
          } = cleanProfileCardText(item.rawName, item.rawHeadline, item.rawLocation);

          let degree: number | null = null;
          if (item.rawDegree) {
            if (/1st|1\.º/i.test(item.rawDegree)) degree = 1;
            else if (/2nd|2\.º/i.test(item.rawDegree)) degree = 2;
            else if (/3rd|3\.º/i.test(item.rawDegree)) degree = 3;
          }

          const finalCompany = filters.company?.trim() || autoComp || extractCompanyFromHeadline(cleanTitle);

          let finalImage: string | null = null;
          if (item.rawImage && item.rawImage.startsWith("http") && item.rawImage.includes("licdn.com")) {
            finalImage = item.rawImage;
          }

          const lead: SearchLead = {
            linkedinUrl: cleanUrl,
            fullName: cleanName || "Prospecto de LinkedIn",
            firstName,
            lastName,
            title: cleanTitle,
            company: finalCompany,
            location: cleanLocation || filters.location || null,
            profileImageUrl: finalImage,
            degree,
            summary: item.rawSummary,
          };

          collectedLeads.push(lead);

          onProgress?.({
            phase: "extracting",
            page: pageNum,
            totalPages: estimatedPages,
            totalFound: collectedLeads.length,
            currentLead: lead,
            message: `[DOM] Prospecto captado: ${lead.fullName} (${lead.title || "Sin cargo"})`,
          });
        }

        // If this page found 0 leads on page 1, break from this variant to try next variant
        if (collectedLeads.length === 0 && extractedRaw.length === 0 && pageNum === 1) {
          break;
        }

        if (pageNum < estimatedPages && collectedLeads.length < limit) {
          await page.waitForTimeout(1200 + Math.random() * 800);
        }
      }
    }

    onProgress?.({
      phase: "completed",
      page: estimatedPages,
      totalPages: estimatedPages,
      totalFound: collectedLeads.length,
      message: `Búsqueda finalizada. Se extrajeron ${collectedLeads.length} prospectos.`,
    });

    return collectedLeads;
  } finally {
    try {
      await page.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Saves extracted leads into a new or existing list in SQLite,
 * populating `lists`, `targets`, and `list_targets`.
 */
export function saveProfilesToList(
  db: DB,
  options: {
    listName: string;
    description?: string;
    profiles: SearchLead[];
    workspaceOwnerId?: string | null;
  }
): { listId: string; listName: string; importedCount: number; updatedCount: number } {
  const { listName, description, profiles } = options;
  const listId = randomUUID();

  let importedCount = 0;
  let updatedCount = 0;

  const insertList = db.prepare(`
    INSERT INTO lists (id, name, description, purpose, created_at)
    VALUES (?, ?, ?, 'linkedin', datetime('now'))
  `);

  const findByLinkedin = db.prepare("SELECT id FROM targets WHERE linkedin_url = ?");

  const insertTarget = db.prepare(`
    INSERT INTO targets (
      id, linkedin_url, full_name, first_name, last_name,
      title, company, location, email, phone, profile_image_url, degree, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const updateTarget = db.prepare(`
    UPDATE targets SET
      full_name = COALESCE(?, full_name),
      first_name = COALESCE(?, first_name),
      last_name = COALESCE(?, last_name),
      title = COALESCE(?, title),
      company = COALESCE(?, company),
      location = COALESCE(?, location),
      email = COALESCE(?, email),
      phone = COALESCE(?, phone),
      profile_image_url = COALESCE(?, profile_image_url),
      degree = COALESCE(?, degree)
    WHERE id = ?
  `);

  const linkToList = db.prepare(`
    INSERT OR IGNORE INTO list_targets (list_id, target_id)
    VALUES (?, ?)
  `);

  db.transaction(() => {
    insertList.run(
      listId,
      listName.trim() || `Búsqueda LinkedIn - ${new Date().toLocaleDateString()}`,
      description || `Captados mediante Lead Finder (${profiles.length} prospectos)`
    );

    for (const lead of profiles) {
      const existing = findByLinkedin.get(lead.linkedinUrl) as { id: string } | undefined;
      let targetId: string;

      if (existing) {
        targetId = existing.id;
        updateTarget.run(
          lead.fullName,
          lead.firstName,
          lead.lastName,
          lead.title,
          lead.company,
          lead.location,
          lead.email || null,
          lead.phone || null,
          lead.profileImageUrl,
          lead.degree,
          targetId
        );
        updatedCount++;
      } else {
        targetId = randomUUID();
        insertTarget.run(
          targetId,
          lead.linkedinUrl,
          lead.fullName,
          lead.firstName,
          lead.lastName,
          lead.title,
          lead.company,
          lead.location,
          lead.email || null,
          lead.phone || null,
          lead.profileImageUrl,
          lead.degree
        );
        importedCount++;
      }

      linkToList.run(listId, targetId);

      // Automatically resolve and link company
      if (lead.company || lead.email) {
        const companyId = resolveOrCreateCompany(db, {
          name: lead.company,
          domain: extractDomain(lead.email),
          location: lead.location,
          workspaceOwnerId: options.workspaceOwnerId,
        });
        if (companyId) {
          linkTargetToCompany(db, targetId, companyId, lead.company);
        }
      }
    }
  })();

  return {
    listId,
    listName,
    importedCount,
    updatedCount,
  };
}
