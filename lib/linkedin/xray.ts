import { WebSearchClient, WebSearchProviderError } from "@/lib/serper/client";
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
  ceo: ['"CEO"', '"Chief Executive Officer"', '"Director General"', '"Gerente General"', '"Presidente Ejecutivo"', '"Founder"'],
  ceos: ['"CEO"', '"Chief Executive Officer"', '"Director General"', '"Gerente General"'],
  director: ['"Director"', '"Directora"', '"Director General"', '"Gerente General"', '"Managing Director"', '"Head"'],
  directores: ['"Director"', '"Directores"', '"Director General"', '"Gerente General"'],
  gerente: ['"Gerente General"', '"Gerente"', '"General Manager"', '"Managing Director"'],
  founder: ['"Founder"', '"Co-Founder"', '"Fundador"', '"CEO"'],
  fundador: ['"Fundador"', '"Co-Fundador"', '"Founder"', '"CEO"'],
  comercial: ['"Director Comercial"', '"Gerente Comercial"', '"Head of Sales"', '"VP of Sales"'],
  ventas: ['"Director de Ventas"', '"Gerente de Ventas"', '"Head of Sales"'],
  marketing: ['"Director de Marketing"', '"Diretor de Marketing"', '"Head of Marketing"', '"CMO"', '"Gerente de Marketing"'],
  operaciones: ['"Director de Operaciones"', '"COO"', '"Chief Operating Officer"', '"Gerente de Operaciones"'],
  finanzas: ['"Director Financiero"', '"CFO"', '"Chief Financial Officer"', '"Gerente de Finanzas"'],
  tecnologia: ['"Director de Tecnología"', '"CTO"', '"Chief Technology Officer"', '"Head of Engineering"'],
  abogado: ['"Abogado"', '"Abogada"', '"Socio"', '"Legal Counsel"', '"Partner"'],
  dentista: ['"Dentista"', '"Odontólogo"', '"Odontóloga"', '"Cirujano Dentista"'],
};

export interface XRaySearchOptions {
  title?: string;
  location?: string;
  country?: string;
  city?: string;
  company?: string;
  keywords?: string;
  limit?: number;
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

  for (const t of rawTitleTokens) {
    const lower = t.toLowerCase();
    const syns = XRAY_TITLE_SYNONYMS[lower];
    if (syns && syns.length > 0) {
      for (const s of syns) {
        if (!titleTerms.includes(s)) titleTerms.push(s);
      }
    } else {
      const quoted = t.startsWith('"') ? t : `"${t}"`;
      if (!titleTerms.includes(quoted)) titleTerms.push(quoted);
    }
  }

  const titleClause = titleTerms.length > 0 ? `(${titleTerms.join(" OR ")})` : "";

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
  const maxPages = Math.min(Math.ceil(limit / pageSize), 10);

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

      const lead: SearchLead = {
        linkedinUrl: cleanUrl,
        fullName: parsed.fullName,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        title: parsed.title || options.title || null,
        company: parsed.company || company || null,
        location: effectiveLocation,
        profileImageUrl: null,
        degree: null,
        email: parsed.email,
        phone: parsed.phone,
        summary: item.snippet || null,
      };

      collectedLeads.push(lead);
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
