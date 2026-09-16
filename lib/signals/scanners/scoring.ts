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

export function scoreSignalLead(lead: DiscoveredSignalLead, icp: SignalIcpFilters, nowMs = Date.now()): SignalScore {
  const titleConfigured = Boolean(icp.titles?.length);
  const locationConfigured = Boolean(icp.locations?.length);
  const sizeConfigured = Boolean(icp.company_sizes?.length);
  const titleMatch = titleConfigured ? containsAny(lead.headline, icp.titles || []) : null;
  const locationMatch = locationConfigured ? containsAny(lead.location, icp.locations || []) : null;
  const sizeText = lead.companySize == null ? "" : String(lead.companySize);
  const companySizeMatch = sizeConfigured && sizeText ? containsAny(sizeText, icp.company_sizes || []) : sizeConfigured ? null : null;
  const occurredAt = lead.evidence.occurredAt ? Date.parse(lead.evidence.occurredAt) : Number.NaN;
  const ageHours = Number.isFinite(occurredAt) ? Math.max(0, (nowMs - occurredAt) / 3_600_000) : null;
  const recency = ageHours == null ? 5 : ageHours <= 48 ? 15 : ageHours <= 168 ? 10 : 4;
  const breakdown = {
    signal: SIGNAL_BASE[lead.signalType] || 25,
    title: titleMatch === true ? 22 : titleMatch === false ? 0 : 8,
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
  if (icp.exclusions?.length && (
    containsAny(lead.fullName, icp.exclusions)
    || containsAny(lead.headline, icp.exclusions)
    || containsAny(lead.company, icp.exclusions)
  )) return false;
  if (icp.titles?.length && lead.headline && !containsAny(lead.headline, icp.titles)) return false;
  if (icp.locations?.length && lead.location && !containsAny(lead.location, icp.locations)) return false;
  if (icp.company_sizes?.length && lead.companySize != null && !containsAny(String(lead.companySize), icp.company_sizes)) return false;
  const targetIndustries = [icp.company, ...(icp.industries || [])].filter(Boolean) as string[];
  if (targetIndustries.length > 0) {
    const matchesIndustry = containsAny(lead.company, targetIndustries)
      || containsAny(lead.headline, targetIndustries)
      || containsAny(lead.evidence.snippet, targetIndustries);
    if (!matchesIndustry && (lead.company || lead.headline)) return false;
  }
  return true;
}
