import { createHash } from "node:crypto";
import type { DiscoveredSignalLead } from "./contracts";
import type { SignalIcpFilters } from "../schema";

function normalize(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function canonicalLinkedInProfileUrl(value: string): string | null {
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/\/in\/([^/]+)/i);
    if (!match?.[1]) return null;
    return `https://www.linkedin.com/in/${decodeURIComponent(match[1]).toLowerCase()}/`;
  } catch {
    return null;
  }
}

export function signalIdentity(lead: DiscoveredSignalLead): string {
  return lead.providerId?.trim()
    ? `provider:${lead.providerId.trim()}`
    : `url:${canonicalLinkedInProfileUrl(lead.linkedinUrl) || normalize(lead.linkedinUrl)}`;
}

export function evidenceFingerprint(input: {
  monitorId: string;
  sourceType: string;
  sourceId?: string | null;
  sourceUrl?: string | null;
  providerId?: string | null;
  snippet?: string | null;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([
      input.monitorId,
      input.sourceType,
      input.sourceId || "",
      input.sourceUrl || "",
      input.providerId || "",
      input.snippet || "",
    ]), "utf8")
    .digest("hex");
}

export function extractCompanyFromHeadline(headline: string | null | undefined): string | null {
  if (!headline) return null;
  const cleaned = headline.trim();
  const atMatch = cleaned.match(/(?:^|\s)(?:at|en|@)\s+([^|•,\n/-]+)/i);
  if (atMatch?.[1]?.trim()) {
    const candidate = atMatch[1].trim();
    if (candidate.length >= 2 && candidate.length <= 60) return candidate;
  }
  const pipeMatch = cleaned.match(/\|\s*([^|•,\n]+)$/);
  if (pipeMatch?.[1]?.trim()) {
    const candidate = pipeMatch[1].trim();
    if (candidate.length >= 2 && candidate.length <= 60) return candidate;
  }
  const dashMatch = cleaned.match(/\s+[-–—]\s+([^|•,\n]+)$/);
  if (dashMatch?.[1]?.trim()) {
    const candidate = dashMatch[1].trim();
    if (candidate.length >= 2 && candidate.length <= 60) return candidate;
  }
  return null;
}

function containsAny(value: string | null | undefined, expected: string[]): boolean {
  const normalized = normalize(value);
  return expected.some((item) => normalized.includes(normalize(item)));
}

export interface SignalScore {
  total: number;
  breakdown: {
    signal: number;
    title: number;
    location: number;
    companySize: number;
    recency: number;
    evidenceQuality: number;
  };
  matches: {
    title: boolean | null;
    location: boolean | null;
    companySize: boolean | null;
  };
}

const SIGNAL_BASE: Record<string, number> = {
  high_intent_comments: 38,
  competitor_reactions: 32,
  competitor_audience: 28,
  keyword_intent: 36,
  new_in_role: 38,
  internal_promotion: 40,
  profile_viewers: 40,
  hiring_spree: 34,
  company_growth: 32,
  active_poster: 24,
  funding_round: 42,
  acquisition_event: 40,
  company_news: 30,
  industry_event: 28,
  ask_query: 28,
};

const TITLE_SYNONYMS: Record<string, string[]> = {
  ventas: [
    "ventas", "sales", "comercial", "commercial", "business development",
    "bizdev", "sdr", "bdr", "account executive", "ae", "account manager",
    "kam", "key account", "revenue", "cro", "inside sales", "vendedor",
    "prospeccion", "closer", "outreach", "representante comercial",
    "ejecutivo comercial", "director comercial", "gerente comercial",
    "head of sales", "vp of sales", "sales director", "sales manager",
    "sales representative", "consultor comercial", "growth"
  ],
  marketing: [
    "marketing", "mercadeo", "growth", "cmo", "demand generation", "demand gen",
    "inbound", "content", "seo", "sem", "paid media", "branding", "comunicacion",
    "copywriter", "community manager", "head of growth", "growth hacker",
    "product marketing", "marketing director", "marketing manager", "analista de marketing"
  ],
  ceo: [
    "ceo", "founder", "fundador", "co-founder", "cofundador", "owner",
    "propietario", "director general", "gerente general", "managing director",
    "general manager", "socio", "partner", "presidente", "president"
  ],
  director: [
    "director", "vp", "vice president", "vicepresidente", "head", "lead", "leader",
    "gerente", "manager", "chief", "lider"
  ],
  rrhh: [
    "rrhh", "recursos humanos", "talent", "hr", "people", "recruiter",
    "headhunter", "talent acquisition", "seleccion"
  ],
  operaciones: [
    "operaciones", "operations", "coo", "director de operaciones", "ops"
  ],
  finanzas: [
    "finanzas", "finance", "cfo", "director financiero", "contable", "treasury"
  ],
  tecnologia: [
    "cto", "tech", "tecnologia", "developer", "desarrollador", "software",
    "engineer", "ingeniero", "tech lead", "architect", "data", "it"
  ],
  diseno: [
    "diseno", "diseño", "design", "designer", "disenador", "diseñador", "diseñadora",
    "creative director", "director creativo", "directora creativa", "ui", "ux",
    "art director", "director de arte", "visual", "branding", "graphic designer",
    "diseñador gráfico", "diseñadora gráfica", "motion graphics", "ilustrador", "ilustradora"
  ],
  legal: [
    "abogado", "abogada", "advogado", "advogada", "lawyer", "attorney", "legal",
    "juridico", "jurídico", "direito", "law", "counsel", "general counsel",
    "compliance", "notario", "notaria", "marcas", "inpi", "propiedad intelectual"
  ],
  agencia: [
    "agencia", "agency", "agência", "modelos", "modeling", "model agency", "talent",
    "productor", "productora", "producer", "audiovisual", "fashion", "moda",
    "casting", "fotografo", "fotógrafo", "fotografa", "fotógrafa", "media agency"
  ],
  consultoria: [
    "consultor", "consultora", "consultant", "consulting", "asesor", "asesora",
    "advisor", "coach", "mentor", "mentora", "auditor", "auditora", "socio consultor"
  ],
  servicios: [
    "proveedor", "servicios", "services", "b2b", "director", "gerente",
    "coordinador", "coordinadora", "especialista", "specialist", "partner"
  ],
};

export function expandTitleCriteria(titles: string[]): string[] {
  const result = new Set<string>();
  for (const rawTitle of titles) {
    const norm = normalize(rawTitle);
    if (!norm) continue;
    result.add(rawTitle);
    result.add(norm);

    // Expandir familia si coincide con alguna clave o término de la familia
    for (const [key, synonyms] of Object.entries(TITLE_SYNONYMS)) {
      const matchesKey = norm.includes(key) || key.includes(norm);
      const matchesSynonym = synonyms.some((syn) => norm.includes(syn) || syn.includes(norm));
      if (matchesKey || matchesSynonym) {
        for (const s of synonyms) result.add(s);
      }
    }
  }
  return Array.from(result);
}

const LOCATION_SYNONYMS: Record<string, string[]> = {
  espana: [
    "espana", "españa", "spain", "madrid", "barcelona", "valencia", "sevilla",
    "malaga", "málaga", "bilbao", "zaragoza", "alicante", "cataluna", "cataluña", "catalonia",
    "andalucia", "andalucía", "pais vasco", "país vasco", "galicia", "canarias",
    "baleares", "espanya", "san sebastian", "san sebastián", "vigo", "la coruña", "a coruña"
  ],
  mexico: [
    "mexico", "méxico", "cdmx", "ciudad de mexico", "ciudad de méxico", "guadalajara",
    "monterrey", "puebla", "queretaro", "querétaro", "tijuana", "merida", "mérida",
    "jalisco", "nuevo leon", "nuevo león"
  ],
  colombia: [
    "colombia", "bogota", "bogotá", "medellin", "medellín", "cali", "barranquilla",
    "cartagena", "antioquia", "cundinamarca"
  ],
  chile: [
    "chile", "santiago", "valparaiso", "valparaíso", "concepcion", "concepción",
    "las condes", "providencia"
  ],
  argentina: [
    "argentina", "buenos aires", "caba", "cordoba", "córdoba", "rosario", "mendoza",
    "la plata", "santa fe"
  ],
  peru: [
    "peru", "perú", "lima", "arequipa", "trujillo", "cusco"
  ],
  brasil: [
    "brasil", "brazil", "sao paulo", "são paulo", "rio de janeiro", "curitiba",
    "florianopolis", "florianópolis", "belo horizonte", "porto alegre"
  ],
  usa: [
    "usa", "united states", "eeuu", "estados unidos", "california", "new york",
    "texas", "florida", "san francisco", "sf bay area", "austin", "miami", "seattle",
    "boston", "los angeles", "silicon valley"
  ],
  uk: [
    "uk", "united kingdom", "reino unido", "london", "londres", "manchester", "cambridge", "oxford"
  ],
  francia: [
    "france", "francia", "paris", "parís", "lyon", "marseille", "toulouse"
  ],
  alemania: [
    "germany", "alemania", "deutschland", "berlin", "berlín", "munich", "múnich", "frankfurt", "hamburg", "cologne", "colonia"
  ],
  italia: [
    "italia", "italy", "milan", "milano", "roma", "rome", "turin", "torino", "bologna",
    "napoli", "naples", "florence", "firenze", "genoa", "genova", "venice", "venezia",
    "lombardy", "lombardia", "lazio", "piemonte", "tuscany", "toscana"
  ],
  portugal: [
    "portugal", "lisboa", "lisbon", "porto", "oporto", "braga", "coimbra", "faro", "aveiro"
  ],
  uruguay: [
    "uruguay", "montevideo", "punta del este", "canelones", "maldonado"
  ],
  ecuador: [
    "ecuador", "quito", "guayaquil", "cuenca", "pichincha", "guayas"
  ],
  panama: [
    "panama", "panamá", "ciudad de panama", "ciudad de panamá"
  ],
  "costa rica": [
    "costa rica", "san jose", "san josé", "heredia", "alajuela"
  ],
  "republica dominicana": [
    "republica dominicana", "república dominicana", "dominican republic", "santo domingo", "santiago de los caballeros"
  ],
  guatemala: [
    "guatemala", "ciudad de guatemala"
  ],
  bolivia: [
    "bolivia", "la paz", "santa cruz", "santa cruz de la sierra", "cochabamba"
  ],
  paraguay: [
    "paraguay", "asuncion", "asunción"
  ],
  canada: [
    "canada", "canadá", "toronto", "vancouver", "montreal", "montréal", "ottawa", "calgary",
    "ontario", "quebec", "british columbia", "alberta"
  ],
  "paises bajos": [
    "paises bajos", "países bajos", "netherlands", "holland", "holanda", "amsterdam", "ámsterdam",
    "rotterdam", "utrecht", "the hague", "la haya", "eindhoven"
  ],
  suiza: [
    "suiza", "switzerland", "zurich", "zürich", "geneva", "ginebra", "basel", "basilea", "lausanne", "bern", "berna"
  ],
  suecia: [
    "suecia", "sweden", "stockholm", "estocolmo", "gothenburg", "gotemburgo", "malmo", "malmö"
  ],
  irlanda: [
    "irlanda", "ireland", "dublin", "dublín", "cork", "galway"
  ],
  polonia: [
    "polonia", "poland", "warsaw", "varsovia", "krakow", "cracovia", "wroclaw"
  ],
  belgica: [
    "belgica", "bélgica", "belgium", "brussels", "bruselas", "antwerp", "amberes", "ghent", "gante"
  ],
  austria: [
    "austria", "vienna", "viena", "salzburg", "graz"
  ],
  australia: [
    "australia", "sydney", "melbourne", "brisbane", "perth", "adelaide"
  ],
  israel: [
    "israel", "tel aviv", "jerusalem", "haifa", "herzliya"
  ],
};

export function expandLocationCriteria(locations: string[]): string[] {
  const result = new Set<string>();
  for (const rawLoc of locations) {
    const norm = normalize(rawLoc);
    if (!norm) continue;
    result.add(rawLoc);
    result.add(norm);

    for (const [key, synonyms] of Object.entries(LOCATION_SYNONYMS)) {
      const matchesKey = norm.includes(key) || key.includes(norm);
      const matchesSynonym = synonyms.some((syn) => norm.includes(normalize(syn)) || normalize(syn).includes(norm));
      if (matchesKey || matchesSynonym) {
        for (const s of synonyms) {
          result.add(s);
          result.add(normalize(s));
        }
      }
    }
  }
  return Array.from(result);
}

export function scoreSignalLead(lead: DiscoveredSignalLead, icp: SignalIcpFilters, nowMs = Date.now()): SignalScore {
  const titleConfigured = Boolean(icp.titles?.length);
  const locationConfigured = Boolean(icp.locations?.length);
  const sizeConfigured = Boolean(icp.company_sizes?.length);

  const expandedTitles = titleConfigured ? expandTitleCriteria(icp.titles || []) : [];
  const expandedLocations = locationConfigured ? expandLocationCriteria(icp.locations || []) : [];
  const titleMatch = titleConfigured ? containsAny(lead.headline, expandedTitles) : null;
  const locationMatch = locationConfigured ? containsAny(lead.location, expandedLocations) : null;
  const sizeText = lead.companySize == null ? "" : String(lead.companySize);
  const companySizeMatch = sizeConfigured && sizeText ? containsAny(sizeText, icp.company_sizes || []) : sizeConfigured ? null : null;
  const occurredAt = lead.evidence.occurredAt ? Date.parse(lead.evidence.occurredAt) : Number.NaN;
  const ageHours = Number.isFinite(occurredAt) ? Math.max(0, (nowMs - occurredAt) / 3_600_000) : null;
  const recency = ageHours == null ? 5 : ageHours <= 48 ? 15 : ageHours <= 168 ? 10 : 4;
  const breakdown = {
    signal: SIGNAL_BASE[lead.signalType] || 25,
    title: titleMatch === true ? 22 : titleMatch === false ? 4 : 8,
    location: locationMatch === true ? 14 : locationMatch === false ? 0 : 5,
    companySize: companySizeMatch === true ? 11 : companySizeMatch === false ? 0 : 5,
    recency,
    evidenceQuality: lead.evidence.metadata?.identityVerified === true ? 10 : 0,
  };
  return {
    total: Math.max(0, Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0))),
    breakdown,
    matches: { title: titleMatch, location: locationMatch, companySize: companySizeMatch },
  };
}

export function passesIcp(lead: DiscoveredSignalLead, icp: SignalIcpFilters): boolean {
  const effectiveCompany = lead.company || extractCompanyFromHeadline(lead.headline);

  // 1. Exclusiones obligatorias: si coincide con una exclusión, se descarta siempre
  if (icp.exclusions?.length && (
    containsAny(lead.fullName, icp.exclusions)
    || containsAny(lead.headline, icp.exclusions)
    || containsAny(effectiveCompany, icp.exclusions)
  )) return false;

  const isDirectPostSignal = [
    "post_engagement",
    "high_intent_comments",
    "competitor_reactions",
  ].includes(lead.signalType);

  const isWebVerifiedSignal = [
    "funding_round",
    "acquisition_event",
    "company_news",
    "industry_event",
  ].includes(lead.signalType);

  // 2. Cargos: con expansión semántica inteligente (inglés/español)
  if (icp.titles?.length && lead.headline) {
    const expandedTitles = expandTitleCriteria(icp.titles);
    const matchesTitle = containsAny(lead.headline, expandedTitles);
    if (!matchesTitle && !isDirectPostSignal) {
      return false;
    }
  }

  // 3. Ubicación: verificar si no es Global/Todos
  if (icp.locations?.length) {
    const isGlobal = icp.locations.some((loc) => {
      const n = normalize(loc);
      return n === "global" || n === "todos" || n === "global / todos" || n === "all";
    });
    if (!isGlobal) {
      const expandedLocations = expandLocationCriteria(icp.locations);
      if (lead.location) {
        const matchesLocation = containsAny(lead.location, expandedLocations);
        if (!matchesLocation && !isDirectPostSignal) {
          return false;
        }
      } else {
        if (!isWebVerifiedSignal) return false;
      }
    }
  }

  // 4. Tamaño de empresa
  if (icp.company_sizes?.length && lead.companySize != null && !containsAny(String(lead.companySize), icp.company_sizes)) {
    if (!isDirectPostSignal) return false;
  }

  // 5. Industria o empresa
  const targetIndustries = [icp.company, ...(icp.industries || [])].filter(Boolean) as string[];
  if (targetIndustries.length > 0) {
    const matchesIndustry = containsAny(effectiveCompany, targetIndustries)
      || containsAny(lead.headline, targetIndustries)
      || containsAny(lead.evidence.snippet, targetIndustries);
    if (!matchesIndustry && (effectiveCompany || lead.headline)) {
      if (!isDirectPostSignal) return false;
    }
  }

  return true;
}

