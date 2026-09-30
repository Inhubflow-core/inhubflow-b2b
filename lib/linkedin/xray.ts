import { WebSearchClient, WebSearchProviderError } from "../serper/client";
import { SearchLead, SearchProgressCallback } from "./search";

export * from "../lead-finder/query";
import {
  XRaySearchError,
  buildXRayQuery,
  isLeadTitleRelevant,
  XRaySearchOptions,
} from "../lead-finder/query";

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
