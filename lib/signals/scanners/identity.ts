import type { UnipileProfile, UnipileProfileWorkExperience } from "@/lib/unipile/types";

/**
 * LinkedIn throttles `work_experience` for third-party profiles: it reports
 * `work_experience_total_count: 31` but returns an empty array. Every signal
 * that verifies "does this person work at the company in the article" used to
 * die silently on that empty array. This module resolves current employment
 * from the strongest source available and labels how trustworthy it is, so
 * callers can keep working without inventing evidence.
 */

export type EmploymentConfidence = "high" | "medium" | "none";

export interface ResolvedEmployment {
  company: string | null;
  position: string | null;
  location: string | null;
  confidence: EmploymentConfidence;
  source: "work_experience" | "headline" | null;
  /** True when LinkedIn withheld the experience section on this response. */
  throttled: boolean;
}

const SEGMENT_CUT = /\s*[|·•]\s*|\s+\/\/\s+/;

const COMPANY_SEPARATORS: Array<{ regex: RegExp; strength: "strong" | "weak" }> = [
  { regex: /\s+@\s+/, strength: "strong" },
  { regex: /\s+at\s+/i, strength: "strong" },
  { regex: /\s+en\s+/i, strength: "strong" },
  { regex: /\s+[-–—]\s+/, strength: "weak" },
  { regex: /,\s+/, strength: "weak" },
];

/** Words that mean "this is a job title or a slogan", not a company name. */
const ROLE_WORDS = [
  "sales", "ventas", "marketing", "mercadeo", "manager", "gerente", "director",
  "head", "lead", "lider", "líder", "engineer", "ingeniero", "developer",
  "desarrollador", "consultant", "consultor", "analyst", "analista", "talent",
  "people", "hr", "rrhh", "operations", "operaciones", "finance", "finanzas",
  "technology", "tecnologia", "founder", "fundador", "cofounder", "cofundador",
  "ceo", "cto", "coo", "cfo", "cmo", "vp", "chief", "officer", "president",
  "presidente", "coordinador", "coordinator", "specialist", "especialista",
  "ejecutivo", "executive", "account", "business", "product", "design",
  "designer", "support", "soporte", "success", "intern", "pasante", "board",
  "member", "miembro", "growth", "revenue", "customer", "cliente", "partner",
  "socio", "freelance", "student", "estudiante", "looking", "buscando",
  "helping", "ayudando", "expert", "experto", "enthusiast", "lover", "fan",
];

/** Standalone non-company values that show up as the whole "company". */
const NON_COMPANY_VALUES = new Set([
  "n a", "na", "none", "ninguna", "self employed", "selfemployed", "autonomo",
  "autónomo", "freelance", "freelancer", "independiente", "independent",
  "open to work", "opentowork", "unemployed", "desempleado", "retired",
  "jubilado", "student", "estudiante", "consultant", "consultor",
]);

const MAX_COMPANY_WORDS = 4;

function hasLetter(value: string): boolean {
  return /[\p{L}]/u.test(value);
}

function looksLikeRole(value: string): boolean {
  const normalized = ` ${value.toLowerCase()} `;
  return ROLE_WORDS.some((word) => normalized.includes(` ${word}`) || normalized.includes(` ${word}s`));
}

function cleanCandidate(value: string): string | null {
  const cleaned = value
    .replace(/^["'[(]+/, "")
    .replace(/\s*[.!·,;:|]+$/, "")
    .replace(/^(?:the|la|el|los|las)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 60) return null;
  if (!hasLetter(cleaned)) return null;
  if (cleaned.split(/\s+/).length > MAX_COMPANY_WORDS) return null;
  if (NON_COMPANY_VALUES.has(cleaned.toLowerCase())) return null;
  if (/\d{3,}/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Best-effort company extraction from a LinkedIn headline ("VP Sales at Acme",
 * "Head of Growth – Nubank", "Founder, Acme"). Returns null when the headline
 * carries no plausible employer, so callers never guess.
 */
export function deriveCompanyFromHeadline(headline: string | null | undefined): string | null {
  if (!headline) return null;
  const normalized = headline.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  // Everything past a hard separator is a slogan, a location or a second role.
  const segment = normalized.split(SEGMENT_CUT)[0]?.trim() || "";
  if (!segment) return null;

  for (const { regex, strength } of COMPANY_SEPARATORS) {
    const match = segment.match(regex);
    if (!match || match.index == null) continue;
    const remainder = segment.slice(match.index + match[0].length).trim();
    const candidate = cleanCandidate(remainder);
    if (!candidate) continue;
    // Weak separators (dash, comma) also separate two roles, so a title-looking
    // remainder is rejected there. Strong ones ("at", "@", "en") are trusted.
    if (strength === "weak" && looksLikeRole(candidate)) continue;
    if (looksLikeRole(candidate) && candidate.split(/\s+/).length === 1) continue;
    return candidate;
  }
  return null;
}

export function isExperienceThrottled(profile: UnipileProfile): boolean {
  const sections = Array.isArray(profile.throttled_sections) ? profile.throttled_sections : [];
  const throttled = sections.some(
    (section) => typeof section === "string" && /experience|experiencia|position|cargo|work/i.test(section),
  );
  if (throttled) return true;
  // LinkedIn often reports the count and then withholds the payload.
  const total = (profile as { work_experience_total_count?: unknown }).work_experience_total_count;
  return !profile.work_experience?.length && typeof total === "number" && total > 0;
}

export function currentExperience(profile: UnipileProfile): UnipileProfileWorkExperience | null {
  return profile.work_experience?.find((item) => item.current) || profile.work_experience?.[0] || null;
}

export function resolveEmployment(
  profile: UnipileProfile,
  options: { headline?: string | null } = {},
): ResolvedEmployment {
  const throttled = isExperienceThrottled(profile);
  const current = currentExperience(profile);
  const location = profile.location || current?.location || null;

  if (current?.company?.trim()) {
    return {
      company: current.company.trim(),
      position: current.position?.trim() || null,
      location: current.location || location,
      confidence: "high",
      source: "work_experience",
      throttled,
    };
  }

  const derived = deriveCompanyFromHeadline(profile.headline || options.headline);
  if (derived) {
    return {
      company: derived,
      position: null,
      location,
      confidence: "medium",
      source: "headline",
      throttled,
    };
  }

  return {
    company: null,
    position: null,
    location,
    confidence: "none",
    source: null,
    throttled,
  };
}
