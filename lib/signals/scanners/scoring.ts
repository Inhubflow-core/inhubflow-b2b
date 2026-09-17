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

export function scoreSignalLead(lead: DiscoveredSignalLead, icp: SignalIcpFilters, nowMs = Date.now()): SignalScore {
  const titleConfigured = Boolean(icp.titles?.length);
  const locationConfigured = Boolean(icp.locations?.length);
  const sizeConfigured = Boolean(icp.company_sizes?.length);

  const expandedTitles = titleConfigured ? expandTitleCriteria(icp.titles || []) : [];
  const titleMatch = titleConfigured ? containsAny(lead.headline, expandedTitles) : null;
  const locationMatch = locationConfigured ? containsAny(lead.location, icp.locations || []) : null;
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
  // 1. Exclusiones obligatorias: si coincide con una exclusión, se descarta siempre
  if (icp.exclusions?.length && (
    containsAny(lead.fullName, icp.exclusions)
    || containsAny(lead.headline, icp.exclusions)
    || containsAny(lead.company, icp.exclusions)
  )) return false;

  const isDirectPostSignal = [
    "post_engagement",
    "high_intent_comments",
    "competitor_reactions",
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
  if (icp.locations?.length && lead.location) {
    const isGlobal = icp.locations.some((loc) => {
      const n = normalize(loc);
      return n === "global" || n === "todos" || n === "global / todos" || n === "all";
    });
    if (!isGlobal && !containsAny(lead.location, icp.locations)) {
      if (!isDirectPostSignal) return false;
    }
  }

  // 4. Tamaño de empresa
  if (icp.company_sizes?.length && lead.companySize != null && !containsAny(String(lead.companySize), icp.company_sizes)) {
    if (!isDirectPostSignal) return false;
  }

  // 5. Industria o empresa
  const targetIndustries = [icp.company, ...(icp.industries || [])].filter(Boolean) as string[];
  if (targetIndustries.length > 0) {
    const matchesIndustry = containsAny(lead.company, targetIndustries)
      || containsAny(lead.headline, targetIndustries)
      || containsAny(lead.evidence.snippet, targetIndustries);
    if (!matchesIndustry && (lead.company || lead.headline)) {
      if (!isDirectPostSignal) return false;
    }
  }

  return true;
}

