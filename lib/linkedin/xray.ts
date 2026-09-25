import { WebSearchClient, WebSearchProviderError } from "../serper/client";
import { SearchLead, SearchProgressCallback } from "./search";

export type XRayErrorCode =
  | "browser_unavailable"
  | "google_blocked"
  | "timeout"
  | "no_results"
  | "provider_error";

export class XRaySearchError extends Error {
  code: XRayErrorCode;
  constructor(message: string, code: XRayErrorCode) {
    super(message);
    this.name = "XRaySearchError";
    this.code = code;
  }
}

// Country code mapping to LinkedIn national subdomains
export const COUNTRY_SUBDOMAINS: Record<string, { code: string; name: string }> = {
  chile: { code: "cl", name: "Chile" },
  santiago: { code: "cl", name: "Chile" },
  valparaiso: { code: "cl", name: "Chile" },
  concepcion: { code: "cl", name: "Chile" },

  brasil: { code: "br", name: "Brasil" },
  brazil: { code: "br", name: "Brasil" },
  "sao paulo": { code: "br", name: "Brasil" },
  "são paulo": { code: "br", name: "Brasil" },
  "rio de janeiro": { code: "br", name: "Brasil" },
  "belo horizonte": { code: "br", name: "Brasil" },
  curitiba: { code: "br", name: "Brasil" },

  peru: { code: "pe", name: "Perú" },
  perú: { code: "pe", name: "Perú" },
  lima: { code: "pe", name: "Perú" },

  colombia: { code: "co", name: "Colombia" },
  bogota: { code: "co", name: "Colombia" },
  bogotá: { code: "co", name: "Colombia" },
  medellin: { code: "co", name: "Colombia" },
  medellín: { code: "co", name: "Colombia" },
  cali: { code: "co", name: "Colombia" },

  espana: { code: "es", name: "España" },
  españa: { code: "es", name: "España" },
  spain: { code: "es", name: "España" },
  madrid: { code: "es", name: "España" },
  barcelona: { code: "es", name: "España" },
  valencia: { code: "es", name: "España" },

  mexico: { code: "mx", name: "México" },
  méxico: { code: "mx", name: "México" },
  "ciudad de mexico": { code: "mx", name: "México" },
  "ciudad de méxico": { code: "mx", name: "México" },
  cdmx: { code: "mx", name: "México" },
  monterrey: { code: "mx", name: "México" },
  guadalajara: { code: "mx", name: "México" },

  argentina: { code: "ar", name: "Argentina" },
  "buenos aires": { code: "ar", name: "Argentina" },
  cordoba: { code: "ar", name: "Argentina" },

  venezuela: { code: "ve", name: "Venezuela" },
  caracas: { code: "ve", name: "Venezuela" },

  uruguay: { code: "uy", name: "Uruguay" },
  montevideo: { code: "uy", name: "Uruguay" },

  ecuador: { code: "ec", name: "Ecuador" },
  quito: { code: "ec", name: "Ecuador" },
  guayaquil: { code: "ec", name: "Ecuador" },

  panama: { code: "pa", name: "Panamá" },
  panamá: { code: "pa", name: "Panamá" },

  usa: { code: "www", name: "Estados Unidos" },
  "estados unidos": { code: "www", name: "Estados Unidos" },
  "united states": { code: "www", name: "Estados Unidos" },
  miami: { code: "www", name: "Estados Unidos" },
  florida: { code: "www", name: "Estados Unidos" },
};

// Title synonyms for Google X-Ray boolean OR expansions
export const XRAY_TITLE_SYNONYMS: Record<string, string[]> = {
  // Executive / Leadership
  ceo: ['"CEO"', '"Chief Executive Officer"', '"Director General"', '"Gerente General"', '"Presidente Ejecutivo"', '"Founder"'],
  ceos: ['"CEO"', '"Chief Executive Officer"', '"Director General"', '"Gerente General"'],
  director: ['"Director"', '"Directora"', '"Director General"', '"Gerente General"', '"Managing Director"', '"Head"'],
  directores: ['"Director"', '"Directores"', '"Director General"', '"Gerente General"'],
  directora: ['"Directora"', '"Director"', '"Directora General"', '"Gerente General"'],
  gerente: ['"Gerente General"', '"Gerente"', '"General Manager"', '"Managing Director"'],
  "gerente general": ['"Gerente General"', '"General Manager"', '"Managing Director"', '"Director General"', '"CEO"'],
  "director general": ['"Director General"', '"Directora General"', '"Gerente General"', '"Managing Director"', '"CEO"'],
  founder: ['"Founder"', '"Co-Founder"', '"Fundador"', '"CEO"'],
  fundador: ['"Fundador"', '"Co-Fundador"', '"Founder"', '"CEO"'],
  coordinador: ['"Coordinador"', '"Coordinadora"', '"Coordinator"', '"Jefe"'],
  jefe: ['"Jefe"', '"Jefa"', '"Líder"', '"Head"'],

  // Marketing (Multi-word compound phrases)
  "director de marketing": [
    '"Director de Marketing"',
    '"Directora de Marketing"',
    '"Gerente de Marketing"',
    '"Head of Marketing"',
    '"CMO"',
    '"Chief Marketing Officer"',
    '"VP of Marketing"',
    '"Director de Mercadotecnia"',
    '"Gerente de Mercadotecnia"',
    '"Director de Mercadeo"',
  ],
  "directora de marketing": [
    '"Directora de Marketing"',
    '"Director de Marketing"',
    '"Gerente de Marketing"',
    '"Head of Marketing"',
    '"CMO"',
    '"Chief Marketing Officer"',
    '"VP of Marketing"',
  ],
  "gerente de marketing": [
    '"Gerente de Marketing"',
    '"Director de Marketing"',
    '"Directora de Marketing"',
    '"Head of Marketing"',
    '"CMO"',
    '"Chief Marketing Officer"',
    '"Gerente de Mercadotecnia"',
    '"Gerente de Mercadeo"',
  ],
  "head of marketing": [
    '"Head of Marketing"',
    '"Director de Marketing"',
    '"Directora de Marketing"',
    '"Gerente de Marketing"',
    '"CMO"',
    '"VP of Marketing"',
  ],
  cmo: ['"CMO"', '"Chief Marketing Officer"', '"Director de Marketing"', '"Head of Marketing"', '"VP of Marketing"'],
  marketing: ['"Director de Marketing"', '"Diretor de Marketing"', '"Head of Marketing"', '"CMO"', '"Gerente de Marketing"', '"Marketing Director"'],

  // Sales / Commercial
  "director comercial": [
    '"Director Comercial"',
    '"Directora Comercial"',
    '"Gerente Comercial"',
    '"Head of Sales"',
    '"VP of Sales"',
    '"Chief Commercial Officer"',
    '"CRO"',
    '"Director de Ventas"',
  ],
  "directora comercial": [
    '"Directora Comercial"',
    '"Director Comercial"',
    '"Gerente Comercial"',
    '"Head of Sales"',
    '"VP of Sales"',
  ],
  "director de ventas": [
    '"Director de Ventas"',
    '"Directora de Ventas"',
    '"Gerente de Ventas"',
    '"Head of Sales"',
    '"VP of Sales"',
    '"Director Comercial"',
    '"Gerente Comercial"',
  ],
  "gerente comercial": [
    '"Gerente Comercial"',
    '"Director Comercial"',
    '"Gerente de Ventas"',
    '"Head of Sales"',
    '"VP of Sales"',
  ],
  "gerente de ventas": [
    '"Gerente de Ventas"',
    '"Director de Ventas"',
    '"Gerente Comercial"',
    '"Head of Sales"',
  ],
  comercial: ['"Director Comercial"', '"Gerente Comercial"', '"Head of Sales"', '"VP of Sales"'],
  ventas: ['"Director de Ventas"', '"Gerente de Ventas"', '"Head of Sales"'],

  // Operations
  "director de operaciones": [
    '"Director de Operaciones"',
    '"Directora de Operaciones"',
    '"Gerente de Operaciones"',
    '"COO"',
    '"Chief Operating Officer"',
    '"Head of Operations"',
    '"VP of Operations"',
  ],
  "gerente de operaciones": [
    '"Gerente de Operaciones"',
    '"Director de Operaciones"',
    '"COO"',
    '"Head of Operations"',
  ],
  operaciones: ['"Director de Operaciones"', '"COO"', '"Chief Operating Officer"', '"Gerente de Operaciones"'],

  // Finance
  "director financiero": [
    '"Director Financiero"',
    '"Directora Financiera"',
    '"Director de Finanzas"',
    '"Gerente de Finanzas"',
    '"CFO"',
    '"Chief Financial Officer"',
    '"Head of Finance"',
  ],
  "director de finanzas": [
    '"Director de Finanzas"',
    '"Directora de Finanzas"',
    '"Director Financiero"',
    '"Gerente de Finanzas"',
    '"CFO"',
    '"Chief Financial Officer"',
    '"Head of Finance"',
  ],
  "gerente de finanzas": [
    '"Gerente de Finanzas"',
    '"Director Financiero"',
    '"Director de Finanzas"',
    '"CFO"',
    '"Head of Finance"',
  ],
  finanzas: ['"Director Financiero"', '"CFO"', '"Chief Financial Officer"', '"Gerente de Finanzas"'],

  // Technology
  "director de tecnologia": [
    '"Director de Tecnología"',
    '"Director de TI"',
    '"CTO"',
    '"Chief Technology Officer"',
    '"Head of Engineering"',
    '"VP of Engineering"',
    '"Gerente de Tecnología"',
  ],
  "director de tecnología": [
    '"Director de Tecnología"',
    '"Director de TI"',
    '"CTO"',
    '"Chief Technology Officer"',
    '"Head of Engineering"',
    '"VP of Engineering"',
    '"Gerente de Tecnología"',
  ],
  "gerente de tecnologia": [
    '"Gerente de Tecnología"',
    '"Director de Tecnología"',
    '"CTO"',
    '"Head of Engineering"',
    '"Gerente de Sistemas"',
  ],
  cto: ['"CTO"', '"Chief Technology Officer"', '"Director de Tecnología"', '"Head of Engineering"', '"VP of Engineering"'],
  tecnologia: ['"Director de Tecnología"', '"CTO"', '"Chief Technology Officer"', '"Head of Engineering"'],

  // HR / People
  "director de recursos humanos": [
    '"Director de Recursos Humanos"',
    '"Directora de Recursos Humanos"',
    '"Gerente de Recursos Humanos"',
    '"Gerente de RRHH"',
    '"Director de RRHH"',
    '"CHRO"',
    '"Chief Human Resources Officer"',
    '"Head of People"',
  ],
  "gerente de recursos humanos": [
    '"Gerente de Recursos Humanos"',
    '"Gerente de RRHH"',
    '"Director de Recursos Humanos"',
    '"Head of People"',
    '"Chief Human Resources Officer"',
  ],
  "recursos humanos": ['"Director de Recursos Humanos"', '"Gerente de RRHH"', '"Head of People"', '"CHRO"'],
  rrhh: ['"Director de RRHH"', '"Gerente de RRHH"', '"Head of People"', '"CHRO"'],

  // Legal
  abogado: ['"Abogado"', '"Abogada"', '"Socio"', '"Legal Counsel"', '"Partner"'],
  dentista: ['"Dentista"', '"Odontólogo"', '"Odontóloga"', '"Cirujano Dentista"'],
};

export const DISCIPLINE_KEYWORDS: Record<string, string[]> = {
  marketing: ["marketing", "mercadotecnia", "mercadeo", "cmo", "growth", "marcom", "brand", "branding"],
  ventas: ["ventas", "comercial", "sales", "revenue", "cro", "bdr", "sdr", "account executive", "kam", "key account"],
  finanzas: ["finanzas", "financiero", "financiera", "finance", "cfo", "controller", "tesoreria", "contable", "contabilidad"],
  operaciones: ["operaciones", "operativo", "operativa", "operations", "coo", "logistica", "supply chain", "cadena de suministro"],
  tecnologia: ["tecnologia", "technology", "ti", "it", "cto", "software", "sistemas", "engineering", "desarrollo", "tech", "cio"],
  rrhh: ["recursos humanos", "rrhh", "human resources", "hr", "people", "talento", "talent", "cultura"],
  legal: ["legal", "juridico", "juridica", "abogado", "abogada", "lawyer", "counsel", "socio"],
  producto: ["producto", "product", "cpo", "product manager"],
};

export function normalizeSearchText(str: string): string {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Validates whether a prospect's extracted title/headline strictly matches the target search query.
 * For example: if user searched for "Director de Marketing", a lead with title "Director de Finanzas"
 * will return false and be filtered out.
 */
export function isLeadTitleRelevant(
  leadTitle: string | null,
  targetQuery: string,
  snippet?: string | null,
  strict: boolean = true
): boolean {
  if (!strict) return true;
  if (!targetQuery || !targetQuery.trim()) return true;

  const targetNorm = normalizeSearchText(targetQuery);
  const titleNorm = normalizeSearchText(leadTitle || "");
  const snippetNorm = normalizeSearchText(snippet || "");

  const textToCheck = titleNorm || snippetNorm;
  if (!textToCheck) return false;

  let matchedKnownDiscipline = false;

  // 1. Discipline check: if target specifies a discipline, ensure lead matches it
  for (const [, keywords] of Object.entries(DISCIPLINE_KEYWORDS)) {
    const targetHasDiscipline = keywords.some((kw) => {
      const regex = new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`, "i");
      return regex.test(targetNorm);
    });

    if (targetHasDiscipline) {
      matchedKnownDiscipline = true;
      // Must match at least one keyword of this discipline in title or snippet headline
      const leadMatches = keywords.some((kw) => {
        const regex = new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`, "i");
        return regex.test(titleNorm) || (titleNorm === "" && regex.test(snippetNorm));
      });

      if (!leadMatches) {
        // Mismatch! e.g., lead is "Director de Operaciones" but target required "marketing"
        return false;
      }
    }
  }

  // 2. Executive / Seniority check: reject junior/intern roles when searching for executive/director
  const isTargetExecutive =
    /\b(director|directora|gerente|head|vp|cmo|cfo|coo|cto|ceo|chief|lider|líder|socio)\b/i.test(targetNorm);

  if (isTargetExecutive) {
    const isJunior = /\b(practicante|pasante|intern\b|internship|trainee|asistente de|assistant to)\b/i.test(titleNorm);
    if (isJunior) {
      return false;
    }
  }

  // 3. Fallback for custom specialty words not in DISCIPLINE_KEYWORDS (e.g. "Ciberseguridad")
  if (!matchedKnownDiscipline) {
    const stopWords = new Set([
      "de", "del", "en", "para", "con", "los", "las", "el", "la", "un", "una", "y", "o",
      "the", "and", "of", "in", "at", "for", "to", "a"
    ]);
    const knownSeniorities = new Set([
      "director", "directora", "gerente", "head", "vp", "chief", "manager", "lider",
      "jefe", "jefa", "coordinador", "coordinadora", "ejecutivo", "ejecutiva", "general",
      "founder", "fundador", "ceo"
    ]);

    const rawTokens = targetNorm.split(/[\s,;/|-]+/).filter((t) => t.length > 3 && !stopWords.has(t));
    const specialtyTokens = rawTokens.filter((t) => !knownSeniorities.has(t));

    if (specialtyTokens.length > 0) {
      const hasSpecialtyMatch = specialtyTokens.some((st) => {
        const stem = st.length > 5 ? st.slice(0, 5) : st;
        return titleNorm.includes(stem) || snippetNorm.includes(stem);
      });
      if (!hasSpecialtyMatch) {
        return false;
      }
    }
  }

  return true;
}

export interface XRaySearchOptions {
  title?: string;
  location?: string;
  country?: string;
  city?: string;
  company?: string;
  keywords?: string;
  limit?: number;
  strictTitle?: boolean;
}

/**
 * Identifies the national subdomain from location text (e.g. "Santiago, Chile" -> "cl")
 */
export function resolveSubdomain(locationText?: string): { code: string; name: string } {
  if (!locationText) return { code: "www", name: "Global" };
  const clean = locationText.toLowerCase().replace(/[,.;:/\\-]/g, " ").trim();
  for (const [key, mapping] of Object.entries(COUNTRY_SUBDOMAINS)) {
    if (clean.includes(key)) {
      return mapping;
    }
  }
  return { code: "www", name: locationText };
}

/**
 * Builds the exact Google X-Ray Boolean query string.
 * Example:
 * site:cl.linkedin.com/in/ ("CEO" OR "Chief Executive Officer" OR "Director General") "Mineria" "Santiago" -intitle:"profiles" -inurl:"dir/"
 */
export function buildXRayQuery(options: XRaySearchOptions): { query: string; subdomain: string; countryName: string } {
  const { title = "", location = "", country = "", city = "", company = "", keywords = "" } = options;
  const countryInput = country.trim() || location;
  const { code: subCode, name: countryName } = resolveSubdomain(countryInput);

  const siteClause = subCode === "www"
    ? `(site:linkedin.com/in/ OR site:www.linkedin.com/in/)`
    : `(site:${subCode}.linkedin.com/in/ OR site:linkedin.com/in/ OR site:www.linkedin.com/in/)`;

  // Build title boolean group
  const rawTitleTokens = title.split(/[,;/|]+/).map((s) => s.trim()).filter(Boolean);
  const titleTerms: string[] = [];

  const wholeNorm = normalizeSearchText(title);
  const seniorities = ["director", "directora", "gerente", "head", "vp", "chief", "lider", "jefe", "manager", "ceo"];
  const hasSeniority = seniorities.some((s) => wholeNorm.includes(s));
  let matchedDisciplineKeywords: string[] | null = null;

  for (const [, kws] of Object.entries(DISCIPLINE_KEYWORDS)) {
    if (kws.some((kw) => {
      const regex = new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`, "i");
      return regex.test(wholeNorm);
    })) {
      matchedDisciplineKeywords = kws;
      break;
    }
  }

  // 1. Direct match on rich synonym dictionary (e.g. "Director de Marketing")
  if (XRAY_TITLE_SYNONYMS[wholeNorm]) {
    for (const s of XRAY_TITLE_SYNONYMS[wholeNorm]) {
      if (!titleTerms.includes(s)) titleTerms.push(s);
    }
  } else if (rawTitleTokens.length > 1 && hasSeniority && matchedDisciplineKeywords) {
    // 2. Compound multi-tokens (e.g. "Director, Marketing"): AND seniority with discipline
    const seniorityTerms = ['"Director"', '"Directora"', '"Gerente"', '"Head"', '"VP"'];
    const discTerms = matchedDisciplineKeywords.slice(0, 4).map((d) => `"${d.charAt(0).toUpperCase() + d.slice(1)}"`);
    titleTerms.push(`(${seniorityTerms.join(" OR ")}) (${discTerms.join(" OR ")})`);
  } else {
    // 3. Fallback token-by-token expansion
    for (const t of rawTitleTokens) {
      const lower = t.toLowerCase();
      const norm = normalizeSearchText(t);
      const syns = XRAY_TITLE_SYNONYMS[norm] || XRAY_TITLE_SYNONYMS[lower];
      if (syns && syns.length > 0) {
        for (const s of syns) {
          if (!titleTerms.includes(s)) titleTerms.push(s);
        }
      } else {
        const quoted = t.startsWith('"') ? t : `"${t}"`;
        if (!titleTerms.includes(quoted)) titleTerms.push(quoted);
      }
    }
  }

  const titleClause =
    titleTerms.length > 0
      ? titleTerms.length === 1 && titleTerms[0].startsWith("(")
        ? titleTerms[0]
        : `(${titleTerms.join(" OR ")})`
      : "";

  // Industry / Company clause (supports multiple industries separated by commas with OR)
  let industryClause = "";
  if (company.trim()) {
    const rawCompTokens = company
      .split(/[,;/|]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const compTerms = rawCompTokens.map((c) => (c.startsWith('"') ? c : `"${c}"`));
    if (compTerms.length === 1) {
      industryClause = compTerms[0];
    } else if (compTerms.length > 1) {
      industryClause = `(${compTerms.join(" OR ")})`;
    }
  }

  // City / Specific location clause
  let cityClause = "";
  if (city.trim()) {
    cityClause = `"${city.trim()}"`;
  } else if (location.trim()) {
    const locLower = location.toLowerCase();
    for (const [cityKey, mapping] of Object.entries(COUNTRY_SUBDOMAINS)) {
      if (cityKey !== mapping.name.toLowerCase() && locLower.includes(cityKey)) {
        const capCity = cityKey.charAt(0).toUpperCase() + cityKey.slice(1);
        cityClause = `"${capCity}"`;
        break;
      }
    }
  }

  // Keywords
  const kwClause = keywords.trim() ? `"${keywords.trim()}"` : "";

  // Assemble full X-Ray query
  const queryParts = [
    siteClause,
    titleClause,
    industryClause,
    cityClause,
    kwClause,
    `-intitle:"profiles"`,
    `-inurl:"dir/"`,
  ].filter(Boolean);

  return {
    query: queryParts.join(" "),
    subdomain: subCode,
    countryName,
  };
}

/**
 * Normalizes LinkedIn profile URL extracted from Google search results.
 */
export function normalizeXRayUrl(rawUrl: string): string | null {
  if (!rawUrl || !rawUrl.includes("linkedin.com/in/")) return null;
  try {
    let target = rawUrl;
    if (target.includes("/url?q=")) {
      const match = target.match(/\/url\?q=([^&]+)/);
      if (match) target = decodeURIComponent(match[1]);
    }
    const urlObj = new URL(target.startsWith("http") ? target : `https://${target}`);
    const cleanPath = urlObj.pathname.split("/").slice(0, 3).join("/");
    if (!cleanPath || cleanPath === "/in" || cleanPath.includes("/dir/")) return null;
    return `https://www.linkedin.com${cleanPath}/`;
  } catch {
    const match = rawUrl.match(/(https?:\/\/[a-z0-9.-]*linkedin\.com\/in\/[^/?#&]+)/i);
    return match ? `${match[1].replace(/\/+$/, "")}/` : null;
  }
}

export function extractContactDetails(
  text: string
): { email: string | null; phone: string | null } {
  if (!text) return { email: null, phone: null };

  const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  const email = emailMatch ? emailMatch[1].toLowerCase() : null;

  const phoneMatch = text.match(/(\+?\d{1,3}[\s-]?\(?\d{1,4}\)?[\s-]?\d{3,5}[\s-]?\d{3,5})/);
  const phone = phoneMatch ? phoneMatch[1].trim() : null;

  return { email, phone };
}

/**
 * Parses Google Search Snippet title (e.g. "Marko Didyk - Director Mineria en CODELCO | LinkedIn")
 * into clean Name, Headline, Company, Email, and Phone.
 */
export function parseXRaySnippet(
  rawTitle: string,
  rawSnippet?: string,
  defaultCompany?: string
): {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
} {
  let clean = rawTitle.replace(/\s*\|\s*LinkedIn.*$/i, "").replace(/\s*-\s*LinkedIn.*$/i, "").trim();
  const parts = clean.split(/\s+[-–—]\s+/);

  let fullName = "Prospecto de LinkedIn";
  let title: string | null = null;
  let company: string | null = defaultCompany || null;

  if (parts.length >= 2) {
    fullName = parts[0].trim();
    title = parts.slice(1).join(" - ").trim();
  } else if (parts.length === 1) {
    fullName = parts[0].trim();
  }

  if (title) {
    const compMatch = title.match(/(?:at|en|@|\|)\s+([^,|•\n]+)/i);
    if (compMatch) {
      company = compMatch[1].trim();
    }
  }

  const nameParts = fullName.split(/\s+/);
  const firstName = nameParts[0] || null;
  const lastName = nameParts.slice(1).join(" ") || null;

  const { email, phone } = extractContactDetails(`${rawTitle} ${rawSnippet || ""}`);

  return {
    fullName,
    firstName,
    lastName,
    title,
    company,
    email,
    phone,
  };
}

/**
 * Executes a fast, reliable Google X-Ray Search using Serper.dev API.
 * Completely immune to datacenter IP blocks, zero CAPTCHAs, requires no headless browser.
 */
export async function searchLinkedInWithSerper(
  options: XRaySearchOptions,
  onProgress?: SearchProgressCallback,
  apiKey?: string
): Promise<SearchLead[]> {
  const serperKey = apiKey || process.env.SERPER_API_KEY;
  if (!serperKey) {
    throw new XRaySearchError(
      "No se ha configurado la variable SERPER_API_KEY en el servidor.",
      "provider_error"
    );
  }

  const { limit = 25, location = "", company = "", country = "", city = "" } = options;
  const { query, subdomain, countryName } = buildXRayQuery(options);

  const collectedLeads: SearchLead[] = [];
  const seenUrls = new Set<string>();

  // Free accounts on Serper must use num: 10
  const pageSize = 10;
  // Allow enough pages to fulfill the requested limit even if some irrelevant results are filtered out
  const maxPages = Math.min(Math.max(Math.ceil((limit * 1.6) / pageSize), 3), 10);

  const gl = subdomain === "www" ? "us" : subdomain;
  const hl = subdomain === "br" ? "pt" : "es";

  onProgress?.({
    phase: "starting",
    page: 1,
    totalPages: maxPages,
    totalFound: 0,
    message: `Iniciando Google X-Ray con Serper.dev para ${countryName}...`,
  });

  const webClient = new WebSearchClient({ apiKey: serperKey });

  for (let pageIdx = 1; pageIdx <= maxPages; pageIdx++) {
    if (collectedLeads.length >= limit) break;

    onProgress?.({
      phase: "navigating",
      page: pageIdx,
      totalPages: maxPages,
      totalFound: collectedLeads.length,
      message: `Consultando prospectos en Google X-Ray (Página ${pageIdx} de ${maxPages})...`,
    });

    let organic: Array<{ title: string; link: string; snippet: string | null }>;
    try {
      const result = await webClient.search({
        query,
        country: gl,
        language: hl,
        limit: pageSize,
        page: pageIdx,
      });
      organic = result.items;
    } catch (error) {
      const message = error instanceof Error ? error.message : "error de red";
      if (error instanceof WebSearchProviderError && error.code === "invalid_credentials") {
        throw new XRaySearchError("La credencial del buscador web no es válida o fue revocada.", "provider_error");
      }
      if (error instanceof WebSearchProviderError && error.code === "rate_limited") {
        throw new XRaySearchError("El buscador web alcanzó temporalmente su límite de consultas.", "provider_error");
      }
      throw new XRaySearchError(`Fallo al consultar el buscador web: ${message}`, "provider_error");
    }

    if (organic.length === 0 && pageIdx === 1) {
      break;
    }

    for (let idx = 0; idx < organic.length; idx++) {
      if (collectedLeads.length >= limit) break;
      const item = organic[idx];
      const cleanUrl = normalizeXRayUrl(item.link || "");
      if (!cleanUrl || seenUrls.has(cleanUrl)) continue;
      seenUrls.add(cleanUrl);

      const parsed = parseXRaySnippet(item.title || "", item.snippet || "", company);
      const effectiveLocation =
        [city, countryName].filter(Boolean).join(", ") || location || countryName;

      // Strict title & discipline relevance verification
      if (options.title && options.strictTitle !== false) {
        const isRelevant = isLeadTitleRelevant(parsed.title, options.title, item.snippet, true);
        if (!isRelevant) {
          // Reject mismatched lead (e.g. "Director de Finanzas" when user searched "Director de Marketing")
          continue;
        }
      }

      const lead: SearchLead = {
        linkedinUrl: cleanUrl,
        fullName: parsed.fullName,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        title: parsed.title || options.title || null,
        company: parsed.company || company || null,
        location: effectiveLocation,
        profileImageUrl: (item as unknown as { imageUrl?: string }).imageUrl || null,
        degree: null,
        email: parsed.email,
        phone: parsed.phone,
        summary: item.snippet || null,
      };

      collectedLeads.push(lead);

      onProgress?.({
        phase: "extracting",
        page: pageIdx,
        totalPages: maxPages,
        totalFound: collectedLeads.length,
        currentLead: lead,
        message: `Verificado prospecto: ${lead.fullName} (${lead.title || ""})...`,
      });
    }

    onProgress?.({
      phase: "extracting",
      page: pageIdx,
      totalPages: maxPages,
      totalFound: collectedLeads.length,
      message: `Encontrados ${collectedLeads.length} de ${limit} prospectos verificados...`,
    });

    if (organic.length < pageSize) {
      // Reached the end of available Google results
      break;
    }
  }

  return collectedLeads;
}

/**
 * Executes Google X-Ray Search through Serper.dev. Local Chromium was retired
 * together with the legacy browser automation engine.
 */
export async function searchLinkedInWithXRay(
  options: XRaySearchOptions,
  onProgress?: SearchProgressCallback
): Promise<SearchLead[]> {
  if (!process.env.SERPER_API_KEY) {
    throw new XRaySearchError(
      "Google X-Ray requiere SERPER_API_KEY; el navegador Chromium local fue retirado.",
      "provider_error"
    );
  }
  return searchLinkedInWithSerper(options, onProgress);
}
