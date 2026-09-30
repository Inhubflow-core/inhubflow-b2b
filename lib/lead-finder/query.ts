// Pure utilities for Google X-Ray Search query generation and lead relevance verification
// Shared safely between server (xray.ts) and client (pages/lead-finder.tsx)

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
  // Chile
  chile: { code: "cl", name: "Chile" },
  cl: { code: "cl", name: "Chile" },
  santiago: { code: "cl", name: "Chile" },
  valparaiso: { code: "cl", name: "Chile" },
  concepcion: { code: "cl", name: "Chile" },

  // Brasil
  brasil: { code: "br", name: "Brasil" },
  brazil: { code: "br", name: "Brasil" },
  br: { code: "br", name: "Brasil" },
  "sao paulo": { code: "br", name: "Brasil" },
  "são paulo": { code: "br", name: "Brasil" },
  "rio de janeiro": { code: "br", name: "Brasil" },
  "belo horizonte": { code: "br", name: "Brasil" },
  curitiba: { code: "br", name: "Brasil" },

  // México
  mexico: { code: "mx", name: "México" },
  méxico: { code: "mx", name: "México" },
  mx: { code: "mx", name: "México" },
  "ciudad de mexico": { code: "mx", name: "México" },
  "ciudad de méxico": { code: "mx", name: "México" },
  cdmx: { code: "mx", name: "México" },
  monterrey: { code: "mx", name: "México" },
  guadalajara: { code: "mx", name: "México" },

  // Colombia
  colombia: { code: "co", name: "Colombia" },
  co: { code: "co", name: "Colombia" },
  bogota: { code: "co", name: "Colombia" },
  bogotá: { code: "co", name: "Colombia" },
  medellin: { code: "co", name: "Colombia" },
  medellín: { code: "co", name: "Colombia" },
  cali: { code: "co", name: "Colombia" },

  // España
  espana: { code: "es", name: "España" },
  españa: { code: "es", name: "España" },
  spain: { code: "es", name: "España" },
  es: { code: "es", name: "España" },
  madrid: { code: "es", name: "España" },
  barcelona: { code: "es", name: "España" },
  valencia: { code: "es", name: "España" },

  // Perú
  peru: { code: "pe", name: "Perú" },
  perú: { code: "pe", name: "Perú" },
  pe: { code: "pe", name: "Perú" },
  lima: { code: "pe", name: "Perú" },

  // Argentina
  argentina: { code: "ar", name: "Argentina" },
  ar: { code: "ar", name: "Argentina" },
  "buenos aires": { code: "ar", name: "Argentina" },
  cordoba: { code: "ar", name: "Argentina" },

  // Uruguay
  uruguay: { code: "uy", name: "Uruguay" },
  uy: { code: "uy", name: "Uruguay" },
  montevideo: { code: "uy", name: "Uruguay" },

  // Ecuador
  ecuador: { code: "ec", name: "Ecuador" },
  ec: { code: "ec", name: "Ecuador" },
  quito: { code: "ec", name: "Ecuador" },
  guayaquil: { code: "ec", name: "Ecuador" },

  // Panamá
  panama: { code: "pa", name: "Panamá" },
  panamá: { code: "pa", name: "Panamá" },
  pa: { code: "pa", name: "Panamá" },

  // Costa Rica
  "costa rica": { code: "cr", name: "Costa Rica" },
  cr: { code: "cr", name: "Costa Rica" },

  // Rep Dominicana
  "republica dominicana": { code: "do", name: "República Dominicana" },
  "república dominicana": { code: "do", name: "República Dominicana" },
  do: { code: "do", name: "República Dominicana" },

  // Guatemala
  guatemala: { code: "gt", name: "Guatemala" },
  gt: { code: "gt", name: "Guatemala" },

  // El Salvador
  "el salvador": { code: "sv", name: "El Salvador" },
  sv: { code: "sv", name: "El Salvador" },

  // Bolivia
  bolivia: { code: "bo", name: "Bolivia" },
  bo: { code: "bo", name: "Bolivia" },

  // Paraguay
  paraguay: { code: "py", name: "Paraguay" },
  py: { code: "py", name: "Paraguay" },

  // Venezuela
  venezuela: { code: "ve", name: "Venezuela" },
  ve: { code: "ve", name: "Venezuela" },
  caracas: { code: "ve", name: "Venezuela" },

  // Puerto Rico
  "puerto rico": { code: "pr", name: "Puerto Rico" },
  pr: { code: "pr", name: "Puerto Rico" },

  // USA
  usa: { code: "www", name: "Estados Unidos" },
  "estados unidos": { code: "www", name: "Estados Unidos" },
  "united states": { code: "www", name: "Estados Unidos" },
  us: { code: "www", name: "Estados Unidos" },
  miami: { code: "www", name: "Estados Unidos" },
  florida: { code: "www", name: "Estados Unidos" },

  // Canadá
  canada: { code: "ca", name: "Canadá" },
  canadá: { code: "ca", name: "Canadá" },
  ca: { code: "ca", name: "Canadá" },

  // Reino Unido
  "reino unido": { code: "uk", name: "Reino Unido" },
  uk: { code: "uk", name: "Reino Unido" },
  "united kingdom": { code: "uk", name: "Reino Unido" },
  london: { code: "uk", name: "Reino Unido" },

  // Alemania
  alemania: { code: "de", name: "Alemania" },
  germany: { code: "de", name: "Alemania" },
  de: { code: "de", name: "Alemania" },
  berlin: { code: "de", name: "Alemania" },

  // Francia
  francia: { code: "fr", name: "Francia" },
  france: { code: "fr", name: "Francia" },
  fr: { code: "fr", name: "Francia" },
  paris: { code: "fr", name: "Francia" },

  // Italia
  italia: { code: "it", name: "Italia" },
  italy: { code: "it", name: "Italia" },
  it: { code: "it", name: "Italia" },
  milano: { code: "it", name: "Italia" },

  // Portugal
  portugal: { code: "pt", name: "Portugal" },
  pt: { code: "pt", name: "Portugal" },

  // Países Bajos
  "paises bajos": { code: "nl", name: "Países Bajos" },
  "países bajos": { code: "nl", name: "Países Bajos" },
  netherlands: { code: "nl", name: "Países Bajos" },
  holanda: { code: "nl", name: "Países Bajos" },
  nl: { code: "nl", name: "Países Bajos" },

  // Suiza
  suiza: { code: "ch", name: "Suiza" },
  switzerland: { code: "ch", name: "Suiza" },
  ch: { code: "ch", name: "Suiza" },

  // Suecia, Noruega, Dinamarca, Finlandia
  suecia: { code: "se", name: "Suecia" },
  sweden: { code: "se", name: "Suecia" },
  se: { code: "se", name: "Suecia" },
  noruega: { code: "no", name: "Noruega" },
  norway: { code: "no", name: "Noruega" },
  no: { code: "no", name: "Noruega" },
  dinamarca: { code: "dk", name: "Dinamarca" },
  denmark: { code: "dk", name: "Dinamarca" },
  dk: { code: "dk", name: "Dinamarca" },
  finlandia: { code: "fi", name: "Finlandia" },
  finland: { code: "fi", name: "Finlandia" },
  fi: { code: "fi", name: "Finlandia" },

  // Polonia, Irlanda, Bélgica, Austria
  polonia: { code: "pl", name: "Polonia" },
  poland: { code: "pl", name: "Polonia" },
  pl: { code: "pl", name: "Polonia" },
  irlanda: { code: "ie", name: "Irlanda" },
  ireland: { code: "ie", name: "Irlanda" },
  ie: { code: "ie", name: "Irlanda" },
  belgica: { code: "be", name: "Bélgica" },
  bélgica: { code: "be", name: "Bélgica" },
  belgium: { code: "be", name: "Bélgica" },
  be: { code: "be", name: "Bélgica" },
  austria: { code: "at", name: "Austria" },
  at: { code: "at", name: "Austria" },

  // Australia & Nueva Zelanda
  australia: { code: "au", name: "Australia" },
  au: { code: "au", name: "Australia" },
  sydney: { code: "au", name: "Australia" },
  "nueva zelanda": { code: "nz", name: "Nueva Zelanda" },
  "new zealand": { code: "nz", name: "Nueva Zelanda" },
  nz: { code: "nz", name: "Nueva Zelanda" },

  // Asia
  "emiratos arabes unidos": { code: "ae", name: "Emiratos Árabes Unidos" },
  "emiratos árabes unidos": { code: "ae", name: "Emiratos Árabes Unidos" },
  ae: { code: "ae", name: "Emiratos Árabes Unidos" },
  dubai: { code: "ae", name: "Emiratos Árabes Unidos" },
  "arabia saudita": { code: "sa", name: "Arabia Saudita" },
  sa: { code: "sa", name: "Arabia Saudita" },
  israel: { code: "il", name: "Israel" },
  il: { code: "il", name: "Israel" },
  singapur: { code: "sg", name: "Singapur" },
  singapore: { code: "sg", name: "Singapur" },
  sg: { code: "sg", name: "Singapur" },
  india: { code: "in", name: "India" },
  in: { code: "in", name: "India" },
  japon: { code: "jp", name: "Japón" },
  japón: { code: "jp", name: "Japón" },
  japan: { code: "jp", name: "Japón" },
  jp: { code: "jp", name: "Japón" },
  corea: { code: "kr", name: "Corea del Sur" },
  kr: { code: "kr", name: "Corea del Sur" },
  "hong kong": { code: "hk", name: "Hong Kong" },
  hk: { code: "hk", name: "Hong Kong" },
  taiwan: { code: "tw", name: "Taiwán" },
  taiwán: { code: "tw", name: "Taiwán" },
  tw: { code: "tw", name: "Taiwán" },
  malasia: { code: "my", name: "Malasia" },
  my: { code: "my", name: "Malasia" },
  filipinas: { code: "ph", name: "Filipinas" },
  philippines: { code: "ph", name: "Filipinas" },
  ph: { code: "ph", name: "Filipinas" },
  tailandia: { code: "th", name: "Tailandia" },
  th: { code: "th", name: "Tailandia" },
  indonesia: { code: "id", name: "Indonesia" },
  id: { code: "id", name: "Indonesia" },
  vietnam: { code: "vn", name: "Vietnam" },
  vn: { code: "vn", name: "Vietnam" },
  turquia: { code: "tr", name: "Turquía" },
  turquía: { code: "tr", name: "Turquía" },
  turkey: { code: "tr", name: "Turquía" },
  tr: { code: "tr", name: "Turquía" },
  qatar: { code: "qa", name: "Qatar" },
  qa: { code: "qa", name: "Qatar" },

  // África
  sudafrica: { code: "za", name: "Sudáfrica" },
  sudáfrica: { code: "za", name: "Sudáfrica" },
  "south africa": { code: "za", name: "Sudáfrica" },
  za: { code: "za", name: "Sudáfrica" },
  egipto: { code: "eg", name: "Egipto" },
  egypt: { code: "eg", name: "Egipto" },
  eg: { code: "eg", name: "Egipto" },
  marruecos: { code: "ma", name: "Marruecos" },
  morocco: { code: "ma", name: "Marruecos" },
  ma: { code: "ma", name: "Marruecos" },
  nigeria: { code: "ng", name: "Nigeria" },
  ng: { code: "ng", name: "Nigeria" },
  kenia: { code: "ke", name: "Kenia" },
  kenya: { code: "ke", name: "Kenia" },
  ke: { code: "ke", name: "Kenia" },
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
  ventas: ["ventas", "comercial", "commercial", "sales", "revenue", "cro", "bdr", "sdr", "account executive", "kam", "key account"],
  finanzas: ["finanzas", "financiero", "financiera", "finance", "financial", "cfo", "controller", "tesoreria", "contable", "contabilidad"],
  operaciones: ["operaciones", "operativo", "operativa", "operations", "coo", "logistica", "logistics", "supply chain", "cadena de suministro"],
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
 * Evaluates whether a lead matches a single target role or discipline.
 */
function matchesSingleRole(
  leadTitleNorm: string,
  snippetNorm: string,
  targetRole: string
): boolean {
  const targetNorm = normalizeSearchText(targetRole);
  if (!targetNorm) return true;

  // 1. Executive / Seniority check: reject junior/intern roles when searching for executive/director
  const isTargetExecutive =
    /\b(director|directora|gerente|head|vp|cmo|cfo|coo|cto|ceo|chief|lider|líder|socio|founder|fundador)\b/i.test(targetNorm);

  if (isTargetExecutive) {
    const isJunior = /\b(practicante|pasante|intern\b|internship|trainee|asistente de|assistant to)\b/i.test(leadTitleNorm);
    if (isJunior) return false;
  }

  // 2. Discipline match
  let hasDisciplineInTarget = false;
  let matchesDiscipline = false;

  for (const [, keywords] of Object.entries(DISCIPLINE_KEYWORDS)) {
    const inTarget = keywords.some((kw) => {
      const regex = new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`, "i");
      return regex.test(targetNorm);
    });

    if (inTarget) {
      hasDisciplineInTarget = true;
      const inLead = keywords.some((kw) => {
        const regex = new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`, "i");
        return regex.test(leadTitleNorm) || regex.test(snippetNorm);
      });
      if (inLead) {
        matchesDiscipline = true;
        break;
      }
    }
  }

  if (hasDisciplineInTarget) {
    return matchesDiscipline;
  }

  // 3. Founder / General Manager checks
  const isTargetFounder = /\b(founder|fundador|co-founder)\b/i.test(targetNorm);
  if (isTargetFounder) {
    return (
      /\b(founder|fundador|co-founder|fundadora|creador|ceo)\b/i.test(leadTitleNorm) ||
      /\b(founder|fundador)\b/i.test(snippetNorm)
    );
  }

  const isTargetGeneral = /\b(gerente general|director general|general manager|ceo)\b/i.test(targetNorm);
  if (isTargetGeneral) {
    return (
      /\b(gerente general|director general|general manager|ceo|managing director)\b/i.test(leadTitleNorm) ||
      /\b(gerente general|director general)\b/i.test(snippetNorm)
    );
  }

  // 4. Fallback for custom specialty words not in DISCIPLINE_KEYWORDS (e.g. "Ciberseguridad")
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
    return specialtyTokens.some((st) => {
      const stem = st.length > 5 ? st.slice(0, 5) : st;
      return leadTitleNorm.includes(stem) || snippetNorm.includes(stem);
    });
  }

  return true;
}

/**
 * Validates whether a prospect's extracted title/headline matches the target search query.
 * If multiple roles are provided (e.g. "Director de Marketing, Director Comercial, Founder"),
 * a prospect is accepted if they match ANY of the requested roles (OR logic).
 */
export function isLeadTitleRelevant(
  leadTitle: string | null,
  targetQuery: string,
  snippet?: string | null,
  strict: boolean = true
): boolean {
  if (!strict) return true;
  if (!targetQuery || !targetQuery.trim()) return true;

  const leadTitleNorm = normalizeSearchText(leadTitle || "");
  const snippetNorm = normalizeSearchText(snippet || "");
  const textToCheck = leadTitleNorm || snippetNorm;
  if (!textToCheck) return false;

  // Split target query into individual roles if user provided multiple comma-separated roles
  const targetRoles = targetQuery
    .split(/[,;/|]+|\b(?:or|o)\b/i)
    .map((s) => s.trim())
    .filter(Boolean);

  if (targetRoles.length === 0) return true;

  // Valid if the lead matches ANY of the target roles (OR logic)
  return targetRoles.some((role) => matchesSingleRole(leadTitleNorm, snippetNorm, role));
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
  showSimilarJobs?: boolean;
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
 * Supports multiple roles combined with OR, just like boolean recruitment search engines.
 * Example:
 * site:cl.linkedin.com/in/ ("Director de Marketing" OR "Gerente de Marketing" OR "CMO") "Santiago" -intitle:"profiles" -inurl:"dir/"
 */
export function buildXRayQuery(options: XRaySearchOptions): { query: string; subdomain: string; countryName: string } {
  const {
    title = "",
    location = "",
    country = "",
    city = "",
    company = "",
    keywords = "",
    showSimilarJobs = true,
  } = options;
  const countryInput = country.trim() || location;
  const { code: subCode, name: countryName } = resolveSubdomain(countryInput);

  const siteClause = subCode === "www"
    ? `(site:linkedin.com/in/ OR site:www.linkedin.com/in/)`
    : `(site:${subCode}.linkedin.com/in/ OR site:linkedin.com/in/ OR site:www.linkedin.com/in/)`;

  // Build title boolean group (supports multiple titles separated by comma / OR)
  const rawTitleTokens = title.split(/[,;/|]+|\b(?:or)\b/i).map((s) => s.trim()).filter(Boolean);
  const titleTerms: string[] = [];
  const wholeNorm = normalizeSearchText(title);

  if (!showSimilarJobs) {
    // Only exact user-provided titles without automatic synonym expansion
    for (const token of rawTitleTokens) {
      const quoted = token.startsWith('"') ? token : `"${token}"`;
      if (!titleTerms.includes(quoted)) titleTerms.push(quoted);
    }
  } else if (rawTitleTokens.length === 1 && XRAY_TITLE_SYNONYMS[wholeNorm]) {
    // Single title with direct dictionary match
    for (const s of XRAY_TITLE_SYNONYMS[wholeNorm]) {
      if (!titleTerms.includes(s)) titleTerms.push(s);
    }
  } else if (rawTitleTokens.length > 0) {
    // Multi-role search: First pass adds the canonical title for EVERY role
    for (const token of rawTitleTokens) {
      const norm = normalizeSearchText(token);
      const syns = XRAY_TITLE_SYNONYMS[norm] || XRAY_TITLE_SYNONYMS[token.toLowerCase()];
      const primary = syns && syns.length > 0 ? syns[0] : (token.startsWith('"') ? token : `"${token}"`);
      if (!titleTerms.includes(primary)) titleTerms.push(primary);
    }

    // Second pass adds top secondary synonyms per role until limit is reached
    for (const token of rawTitleTokens) {
      const norm = normalizeSearchText(token);
      const syns = XRAY_TITLE_SYNONYMS[norm] || XRAY_TITLE_SYNONYMS[token.toLowerCase()];
      if (syns && syns.length > 1) {
        for (const s of syns.slice(1, 3)) {
          if (titleTerms.length >= 18) break;
          if (!titleTerms.includes(s)) titleTerms.push(s);
        }
      }
    }
  }

  // Cap total title terms to 16 to avoid Google query overflow
  const cappedTerms = titleTerms.slice(0, 16);
  const titleClause =
    cappedTerms.length > 0
      ? cappedTerms.length === 1 && cappedTerms[0].startsWith("(")
        ? cappedTerms[0]
        : `(${cappedTerms.join(" OR ")})`
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
 * Builds direct Google Search URL from options.
 */
export function buildGoogleSearchUrl(options: XRaySearchOptions): string {
  const { query } = buildXRayQuery(options);
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * Builds direct Bing Search URL from options.
 */
export function buildBingSearchUrl(options: XRaySearchOptions): string {
  const { query } = buildXRayQuery(options);
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
}
