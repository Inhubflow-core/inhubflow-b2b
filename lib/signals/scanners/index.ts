import type { WebSearchClient } from "@/lib/serper/client";
import type {
  UnipileLinkedInSearchParams,
  UnipileLinkedInSearchResponse,
  UnipilePostComment,
  UnipilePostReaction,
  UnipileProfile,
  UnipileSearchCompany,
  UnipileSearchParameter,
  UnipileSearchPerson,
  UnipileSearchPost,
} from "@/lib/unipile/types";
import type { DiscoveredSignalLead, SignalScanResult, SignalScannerContext } from "./contracts";
import { SignalScanError } from "./contracts";
import { canonicalLinkedInProfileUrl, evidenceFingerprint } from "./scoring";
import { scanWebSignals } from "./web";

export interface SignalScannerClient {
  searchLinkedIn(params: UnipileLinkedInSearchParams): Promise<UnipileLinkedInSearchResponse>;
  listLinkedInSearchParameters(params: {
    account_id: string;
    type: string;
    keywords: string;
    limit?: number;
  }): Promise<{ items: UnipileSearchParameter[] }>;
  getPostComments(postId: string, accountId?: string, limit?: number): Promise<{ items: UnipilePostComment[] }>;
  getPostReactions(postId: string, accountId?: string, limit?: number): Promise<{ items: UnipilePostReaction[] }>;
  resolveProfile(identifier: string, accountId: string): Promise<UnipileProfile>;
}

function cleanSingleUrl(str: string): string {
  return str.replace(/^["'\[\s\\]+|["'\]\s\\]+$/g, "").trim();
}

function postIdentifier(value: string): string | null {
  if (!value || typeof value !== "string") return null;
  const cleaned = cleanSingleUrl(value);
  if (!cleaned) return null;
  const decoded = decodeURIComponent(cleaned);

  // 1. ID puramente numérico (10 a 25 dígitos)
  if (/^[0-9]{10,25}$/.test(decoded)) return decoded;

  // 2. Formato URN estándar (activity, share, ugcPost)
  const urnMatch = decoded.match(/urn:li:(?:activity|share|ugcPost):([0-9]{10,25})/i);
  if (urnMatch) return urnMatch[1];

  // 3. Prefijos en URLs con guión o dos puntos (activity-724..., ugcPost-724..., share-724...)
  const prefixMatch = decoded.match(/(?:activity|share|ugcPost)[-:_]([0-9]{10,25})/i);
  if (prefixMatch) return prefixMatch[1];

  // 4. URLs de updates, posts, shares
  const updateMatch = decoded.match(/(?:update|posts|shares)\/(?:urn:li:[a-z]+:)?([0-9]{10,25})/i);
  if (updateMatch) return updateMatch[1];

  // 5. Fallback por longitud típica de LinkedIn Activity/Post IDs (16 a 22 dígitos)
  const longDigits = decoded.match(/([0-9]{16,22})/);
  if (longDigits) return longDigits[1];

  // 6. Fallback general: cualquier secuencia de 10 a 25 dígitos
  const digitsMatch = decoded.match(/([0-9]{10,25})/);
  if (digitsMatch) return digitsMatch[1];

  return null;
}

function parseTargetUrls(raw?: string | null): string[] {
  if (!raw || typeof raw !== "string" || !raw.trim()) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => cleanSingleUrl(String(item))).filter(Boolean);
      }
    } catch {
      // fallback to delimiter split
    }
  }
  return trimmed
    .split(/[\n,]+/)
    .map((item) => cleanSingleUrl(item))
    .filter(Boolean);
}

function profileUrl(publicIdentifier?: string, explicit?: string): string | null {
  const normalized = explicit ? canonicalLinkedInProfileUrl(explicit) : null;
  if (normalized) return normalized;
  return publicIdentifier ? `https://www.linkedin.com/in/${publicIdentifier}/` : null;
}

function authorLead(input: {
  monitorId: string;
  signalType: string;
  sourceType: string;
  sourceId?: string | null;
  sourceUrl?: string | null;
  occurredAt?: string | null;
  snippet?: string | null;
  id?: string | null;
  publicIdentifier?: string | null;
  name?: string | null;
  headline?: string | null;
  explicitProfileUrl?: string | null;
  metadata?: Record<string, unknown>;
}): DiscoveredSignalLead | null {
  const url = profileUrl(input.publicIdentifier || undefined, input.explicitProfileUrl || undefined);
  const name = input.name?.trim();
  if (!url || !name) return null;
  const providerId = input.id?.trim() || null;
  const fingerprint = evidenceFingerprint({
    monitorId: input.monitorId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceUrl: input.sourceUrl,
    providerId,
    snippet: input.snippet,
  });
  return {
    linkedinUrl: url,
    fullName: name,
    headline: input.headline || null,
    providerId,
    signalType: input.signalType,
    evidence: {
      fingerprint,
      sourceType: input.sourceType,
      sourceId: input.sourceId || null,
      sourceUrl: input.sourceUrl || null,
      occurredAt: input.occurredAt || null,
      snippet: input.snippet || null,
      metadata: input.metadata || {},
    },
  };
}

function searchPersonLead(monitorId: string, signalType: string, item: UnipileSearchPerson, snippet: string): DiscoveredSignalLead | null {
  const url = profileUrl(item.public_identifier, item.profile_url || item.public_profile_url);
  if (!url || !item.name) return null;
  const current = item.current_positions?.[0];
  return {
    linkedinUrl: url,
    providerId: item.id,
    fullName: item.name,
    firstName: item.first_name || null,
    lastName: item.last_name || null,
    headline: item.headline || null,
    company: current?.company || null,
    location: item.location || current?.location || null,
    signalType,
    evidence: {
      fingerprint: evidenceFingerprint({ monitorId, sourceType: "linkedin_people_search", sourceId: item.id, providerId: item.id, snippet }),
      sourceType: "linkedin_people_search",
      sourceId: item.id,
      sourceUrl: url,
      occurredAt: new Date().toISOString(),
      snippet,
      metadata: { currentPosition: current || null },
    },
  };
}

function isPost(item: unknown): item is UnipileSearchPost {
  return Boolean(item && typeof item === "object" && (item as { type?: string }).type === "POST");
}
function isPerson(item: unknown): item is UnipileSearchPerson {
  return Boolean(item && typeof item === "object" && (item as { type?: string }).type === "PEOPLE");
}
function isCompany(item: unknown): item is UnipileSearchCompany {
  return Boolean(item && typeof item === "object" && (item as { type?: string }).type === "COMPANY");
}

async function postSearch(client: SignalScannerClient, context: SignalScannerContext, body: Record<string, unknown>): Promise<{ posts: UnipileSearchPost[]; cursor?: string | null }> {
  const response = await client.searchLinkedIn({
    account_id: context.remoteAccountId,
    api: "classic",
    category: "posts",
    limit: Math.min(context.limit, 49),
    cursor: context.cursor?.cursor || undefined,
    ...body,
  });
  return { posts: response.items.filter(isPost), cursor: response.cursor };
}

async function scanPostEngagement(client: SignalScannerClient, context: SignalScannerContext): Promise<SignalScanResult> {
  const targetUrls = parseTargetUrls(context.monitor.target_url);
  if (targetUrls.length === 0) {
    throw new SignalScanError("Se requiere al menos una URL válida de publicación de LinkedIn", "invalid_configuration", false);
  }

  const postsToScan = targetUrls.slice(0, 5);
  const limitPerPost = Math.max(10, Math.floor(context.limit / postsToScan.length));
  const leads: DiscoveredSignalLead[] = [];
  const seenFingerprints = new Set<string>();

  for (const postUrl of postsToScan) {
    const id = postIdentifier(postUrl);
    if (!id) continue;

    const shouldFetchComments = context.monitor.type !== "competitor_reactions";
    const shouldFetchReactions = context.monitor.type !== "high_intent_comments";

    const [comments, reactions] = await Promise.all([
      (async () => {
        if (!shouldFetchComments) return { items: [] };
        try {
          const res = await client.getPostComments(id, context.remoteAccountId, limitPerPost);
          if (res?.items?.length) return res;
          if (/^[0-9]+$/.test(id)) {
            const urnRes = await client.getPostComments(`urn:li:activity:${id}`, context.remoteAccountId, limitPerPost).catch(() => ({ items: [] }));
            if (urnRes?.items?.length) return urnRes;
          }
          return res || { items: [] };
        } catch {
          if (/^[0-9]+$/.test(id)) {
            return client.getPostComments(`urn:li:activity:${id}`, context.remoteAccountId, limitPerPost).catch(() => ({ items: [] }));
          }
          return { items: [] };
        }
      })(),
      (async () => {
        if (!shouldFetchReactions) return { items: [] };
        try {
          const res = await client.getPostReactions(id, context.remoteAccountId, limitPerPost);
          if (res?.items?.length) return res;
          if (/^[0-9]+$/.test(id)) {
            const urnRes = await client.getPostReactions(`urn:li:activity:${id}`, context.remoteAccountId, limitPerPost).catch(() => ({ items: [] }));
            if (urnRes?.items?.length) return urnRes;
          }
          return res || { items: [] };
        } catch {
          if (/^[0-9]+$/.test(id)) {
            return client.getPostReactions(`urn:li:activity:${id}`, context.remoteAccountId, limitPerPost).catch(() => ({ items: [] }));
          }
          return { items: [] };
        }
      })(),
    ]);

    for (const comment of comments.items || []) {
      const lead = authorLead({
        monitorId: context.monitor.id,
        signalType: context.monitor.type === "post_engagement" ? "post_engagement" : "high_intent_comments",
        sourceType: "post_comment",
        sourceId: comment.id,
        sourceUrl: postUrl,
        occurredAt: comment.created_at || null,
        snippet: comment.text ? `Comentó: “${comment.text.slice(0, 240)}”` : "Comentó en la publicación",
        id: comment.author?.id,
        publicIdentifier: comment.author?.public_identifier,
        name: comment.author?.name || `${comment.author?.first_name || ""} ${comment.author?.last_name || ""}`.trim(),
        headline: comment.author?.headline,
        explicitProfileUrl: comment.author?.profile_url,
        metadata: { commentId: comment.id, postUrl },
      });
      if (lead && !seenFingerprints.has(lead.evidence.fingerprint)) {
        seenFingerprints.add(lead.evidence.fingerprint);
        leads.push(lead);
      }
    }

    for (const reaction of reactions.items || []) {
      const lead = authorLead({
        monitorId: context.monitor.id,
        signalType: context.monitor.type === "post_engagement" ? "post_engagement" : "competitor_reactions",
        sourceType: "post_reaction",
        sourceId: reaction.id || `${id}:${reaction.author?.id}:${reaction.reaction_type || "reaction"}`,
        sourceUrl: postUrl,
        occurredAt: new Date().toISOString(),
        snippet: `Reaccionó (${reaction.reaction_type || "reacción"}) a la publicación`,
        id: reaction.author?.id,
        publicIdentifier: reaction.author?.public_identifier,
        name: reaction.author?.name,
        headline: reaction.author?.headline,
        explicitProfileUrl: reaction.author?.profile_url,
        metadata: { reactionType: reaction.reaction_type || null, postUrl },
      });
      if (lead && !seenFingerprints.has(lead.evidence.fingerprint)) {
        seenFingerprints.add(lead.evidence.fingerprint);
        leads.push(lead);
      }
    }
  }

  if (leads.length === 0 && targetUrls.length > 0) {
    const validIds = targetUrls.map(postIdentifier).filter(Boolean);
    if (validIds.length === 0) {
      throw new SignalScanError("Ninguna de las URLs proporcionadas tiene un ID de publicación de LinkedIn válido", "invalid_configuration", false);
    }
  }

  return { leads };
}

async function scanPosts(client: SignalScannerClient, context: SignalScannerContext, activeOnly: boolean): Promise<SignalScanResult> {
  const keywords = context.keywords.filter(Boolean);
  const targetIndustries = [context.icp.company, ...(context.icp.industries || [])].filter(Boolean) as string[];
  const query = keywords.join(" OR ") || targetIndustries.join(" OR ") || context.monitor.competitor_name || context.icp.titles?.join(" OR ") || "B2B";
  const { posts, cursor } = await postSearch(client, context, {
    keywords: query,
    sort_by: "date",
    date_posted: activeOnly ? "past_week" : "past_week",
    ...(context.icp.titles?.length ? { author: { keywords: context.icp.titles.join(" OR ") } } : {}),
  });
  const cutoff = Date.now() - (activeOnly ? 48 : Math.max(1, context.icp.time_window_days || 7) * 24) * 3_600_000;
  const leads = posts
    .filter((post) => !post.parsed_datetime || Date.parse(post.parsed_datetime) >= cutoff)
    .map((post) => authorLead({
      monitorId: context.monitor.id,
      signalType: activeOnly ? "active_poster" : "keyword_intent",
      sourceType: "post_search",
      sourceId: post.social_id || post.id,
      sourceUrl: post.share_url,
      occurredAt: post.parsed_datetime || null,
      snippet: post.text?.slice(0, 300) || `Publicó sobre ${query}`,
      id: post.author?.id,
      publicIdentifier: post.author?.public_identifier,
      name: post.author?.name,
      headline: post.author?.headline,
      metadata: { reactions: post.reaction_counter || 0, comments: post.comment_counter || 0 },
    }))
    .filter((lead): lead is DiscoveredSignalLead => Boolean(lead));
  return { leads, cursor: { cursor } };
}

async function scanCompetitorAudience(client: SignalScannerClient, context: SignalScannerContext): Promise<SignalScanResult> {
  const subject = context.monitor.competitor_name?.trim();
  if (!subject) throw new SignalScanError("Indica el competidor o referente que deseas analizar", "invalid_configuration", false);
  const { posts, cursor } = await postSearch(client, context, {
    keywords: subject,
    sort_by: "date",
    date_posted: "past_month",
  });
  const leads: DiscoveredSignalLead[] = [];
  for (const post of posts.slice(0, 3)) {
    const postId = postIdentifier(post.social_id || post.share_url || post.id);
    if (!postId) continue;
    const [comments, reactions] = await Promise.all([
      client.getPostComments(postId, context.remoteAccountId, Math.min(context.limit, 25)),
      client.getPostReactions(postId, context.remoteAccountId, Math.min(context.limit, 25)),
    ]);
    for (const comment of comments.items || []) {
      const lead = authorLead({
        monitorId: context.monitor.id,
        signalType: "competitor_audience",
        sourceType: "competitor_post_comment",
        sourceId: comment.id,
        sourceUrl: post.share_url,
        occurredAt: comment.created_at || post.parsed_datetime || null,
        snippet: comment.text?.slice(0, 240) || `Comentó en contenido relacionado con ${subject}`,
        id: comment.author?.id,
        publicIdentifier: comment.author?.public_identifier,
        name: comment.author?.name || `${comment.author?.first_name || ""} ${comment.author?.last_name || ""}`.trim(),
        headline: comment.author?.headline,
        explicitProfileUrl: comment.author?.profile_url,
      });
      if (lead) leads.push(lead);
    }
    for (const reaction of reactions.items || []) {
      const lead = authorLead({
        monitorId: context.monitor.id,
        signalType: "competitor_audience",
        sourceType: "competitor_post_reaction",
        sourceId: reaction.id || `${postId}:${reaction.author?.id}:${reaction.reaction_type || "reaction"}`,
        sourceUrl: post.share_url,
        occurredAt: post.parsed_datetime || null,
        snippet: `Interactuó con contenido relacionado con ${subject}`,
        id: reaction.author?.id,
        publicIdentifier: reaction.author?.public_identifier,
        name: reaction.author?.name,
        headline: reaction.author?.headline,
        explicitProfileUrl: reaction.author?.profile_url,
      });
      if (lead) leads.push(lead);
    }
  }
  return { leads, cursor: { cursor } };
}

function parseExperienceStart(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  const match = value.match(/^(\d{4})(?:-(\d{1,2}))?/);
  return match ? Date.UTC(Number(match[1]), Number(match[2] || 1) - 1, 1) : null;
}

async function scanRoleChanges(client: SignalScannerClient, context: SignalScannerContext): Promise<SignalScanResult> {
  const phrases = context.monitor.type === "internal_promotion"
    ? ["promoted to", "ascendido a", "promovido a"]
    : ["new role", "nuevo cargo", "nueva posición", "nuevo puesto"];
  const { posts, cursor } = await postSearch(client, context, {
    keywords: phrases.join(" OR "),
    sort_by: "date",
    date_posted: "past_month",
    ...(context.icp.titles?.length ? { author: { keywords: context.icp.titles.join(" OR ") } } : {}),
  });
  const leads: DiscoveredSignalLead[] = [];
  const maxAge = Math.max(1, context.icp.time_window_days || 90) * 86_400_000;
  for (const post of posts.slice(0, context.limit)) {
    const url = profileUrl(post.author?.public_identifier);
    if (!url || !post.author?.name) continue;
    try {
      const profile = await client.resolveProfile(url, context.remoteAccountId);
      const current = profile.work_experience?.find((item) => item.current) || profile.work_experience?.[0];
      const prior = profile.work_experience?.find((item) => item !== current);
      const started = parseExperienceStart(current?.start);
      if (started && Date.now() - started > maxAge) continue;
      const internal = Boolean(current?.company && prior?.company && current.company.toLowerCase() === prior.company.toLowerCase());
      if (context.monitor.type === "internal_promotion" && !internal) continue;
      const lead = authorLead({
        monitorId: context.monitor.id,
        signalType: context.monitor.type,
        sourceType: "role_announcement_post",
        sourceId: post.social_id || post.id,
        sourceUrl: post.share_url,
        occurredAt: post.parsed_datetime || (started ? new Date(started).toISOString() : null),
        snippet: post.text?.slice(0, 300) || (internal ? "Ascenso interno reciente" : "Cambio de cargo reciente"),
        id: profile.provider_id,
        publicIdentifier: profile.public_identifier || post.author.public_identifier,
        name: `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || post.author.name,
        headline: profile.headline || post.author.headline,
        explicitProfileUrl: profile.public_profile_url || profile.profile_url || url,
        metadata: { currentRole: current || null, previousRole: prior || null, internalPromotion: internal },
      });
      if (lead) {
        lead.company = current?.company || null;
        lead.location = profile.location || current?.location || null;
        leads.push(lead);
      }
    } catch {
      // A profile that cannot be verified is not emitted as a role-change lead.
    }
  }
  return { leads, cursor: { cursor } };
}

async function resolveLocationIds(client: SignalScannerClient, context: SignalScannerContext): Promise<string[]> {
  const ids: string[] = [];
  for (const location of (context.icp.locations || []).slice(0, 5)) {
    const response = await client.listLinkedInSearchParameters({
      account_id: context.remoteAccountId,
      type: "LOCATION",
      keywords: location,
      limit: 3,
    });
    if (response.items?.[0]?.id) ids.push(response.items[0].id);
  }
  return ids;
}

async function peopleAtCompanies(client: SignalScannerClient, context: SignalScannerContext, companies: UnipileSearchCompany[], signalType: string): Promise<DiscoveredSignalLead[]> {
  const leads: DiscoveredSignalLead[] = [];
  for (const company of companies.slice(0, 5)) {
    const response = await client.searchLinkedIn({
      account_id: context.remoteAccountId,
      api: context.hasSalesNavigator ? "sales_navigator" : "classic",
      category: "people",
      limit: Math.min(10, context.limit),
      ...(context.hasSalesNavigator
        ? { company: { include: [company.id] }, ...(context.icp.titles?.length ? { keywords: context.icp.titles.join(" OR ") } : {}) }
        : { company: [company.id], ...(context.icp.titles?.length ? { advanced_keywords: { title: context.icp.titles.join(" OR ") } } : {}) }),
    });
    for (const person of response.items.filter(isPerson)) {
      const lead = searchPersonLead(context.monitor.id, signalType, person, `${company.name} tiene vacantes o crecimiento activo`);
      if (lead) {
        lead.company = lead.company || company.name;
        lead.companySize = company.headcount || null;
        lead.evidence.sourceType = signalType === "company_growth" ? "company_growth_search" : "company_hiring_search";
        lead.evidence.sourceId = company.id;
        lead.evidence.sourceUrl = company.profile_url || null;
        lead.evidence.metadata = {
          companyId: company.id,
          jobOffers: company.job_offers_count || null,
          headcountGrowth: company.headcount_growth || null,
        };
        leads.push(lead);
      }
    }
  }
  return leads;
}

async function scanCompanies(client: SignalScannerClient, context: SignalScannerContext, growth: boolean): Promise<SignalScanResult> {
  if (growth && !context.hasSalesNavigator) {
    throw new SignalScanError("La señal de crecimiento requiere una cuenta con Sales Navigator", "unsupported_capability", false);
  }
  const locationIds = await resolveLocationIds(client, context);
  const companyKeywords = [
    ...context.keywords,
    ...(context.icp.company ? [context.icp.company] : []),
    ...(context.icp.industries || []),
  ].filter(Boolean);
  const response = await client.searchLinkedIn({
    account_id: context.remoteAccountId,
    api: growth ? "sales_navigator" : "classic",
    category: "companies",
    limit: Math.min(25, context.limit),
    cursor: context.cursor?.cursor || undefined,
    ...(companyKeywords.length ? { keywords: companyKeywords.join(" OR ") } : {}),
    ...(locationIds.length ? (growth ? { location: { include: locationIds } } : { location: locationIds }) : {}),
    ...(growth ? { headcount_growth: { min: 20 } } : { has_job_offers: true }),
  });
  const companies = response.items.filter(isCompany);
  const leads = await peopleAtCompanies(client, context, companies, growth ? "company_growth" : "hiring_spree");
  return { leads, cursor: { cursor: response.cursor } };
}

async function scanSalesNavigatorPeople(client: SignalScannerClient, context: SignalScannerContext): Promise<SignalScanResult> {
  if (!context.hasSalesNavigator) {
    throw new SignalScanError("Esta señal requiere una cuenta con Sales Navigator", "unsupported_capability", false);
  }
  const response = await client.searchLinkedIn({
    account_id: context.remoteAccountId,
    api: "sales_navigator",
    category: "people",
    limit: context.limit,
    cursor: context.cursor?.cursor || undefined,
    viewed_your_profile_recently: true,
    ...(context.icp.titles?.length ? { keywords: context.icp.titles.join(" OR ") } : {}),
  });
  const leads = response.items.filter(isPerson)
    .map((person) => searchPersonLead(context.monitor.id, "profile_viewers", person, "Visitó recientemente tu perfil de LinkedIn"))
    .filter((lead): lead is DiscoveredSignalLead => Boolean(lead));
  return { leads, cursor: { cursor: response.cursor }, capability: "sales_navigator" };
}

function mergeScanResults(results: SignalScanResult[], limit: number): SignalScanResult {
  const leads: DiscoveredSignalLead[] = [];
  const evidenceSeen = new Set<string>();
  for (const result of results) {
    for (const lead of result.leads) {
      if (evidenceSeen.has(lead.evidence.fingerprint)) continue;
      evidenceSeen.add(lead.evidence.fingerprint);
      leads.push(lead);
      if (leads.length >= limit) break;
    }
    if (leads.length >= limit) break;
  }
  return {
    leads,
    cursor: results.find((result) => result.cursor)?.cursor || null,
    capability: results.map((result) => result.capability).filter(Boolean).join("+") || undefined,
  };
}

export async function scanRealSignals(
  client: SignalScannerClient,
  context: SignalScannerContext,
  webClient?: WebSearchClient,
): Promise<SignalScanResult> {
  const webTypes = ["funding_round", "company_news", "acquisition_event", "industry_event"];
  if (webTypes.includes(context.monitor.type)) {
    if (!webClient) throw new SignalScanError("La fuente web complementaria no está configurada", "unsupported_capability", false);
    return scanWebSignals(webClient, client, context);
  }

  if (context.monitor.type === "keyword_intent" && context.icp.source_strategy === "web") {
    if (!webClient) throw new SignalScanError("La fuente web complementaria no está configurada", "unsupported_capability", false);
    return scanWebSignals(webClient, client, context);
  }
  if (context.monitor.type === "keyword_intent" && context.icp.source_strategy === "hybrid" && webClient) {
    const [linkedInResult, webResult] = await Promise.allSettled([
      scanPosts(client, context, false),
      scanWebSignals(webClient, client, context),
    ]);
    const successful = [linkedInResult, webResult]
      .filter((result): result is PromiseFulfilledResult<SignalScanResult> => result.status === "fulfilled")
      .map((result) => result.value);
    if (successful.length > 0) return mergeScanResults(successful, context.limit);
    const reason = linkedInResult.status === "rejected" ? linkedInResult.reason : webResult.status === "rejected" ? webResult.reason : null;
    throw reason instanceof Error ? reason : new SignalScanError("Las fuentes híbridas no respondieron", "provider_error", true);
  }

  switch (context.monitor.type) {
    case "competitor_reactions":
    case "high_intent_comments":
    case "post_engagement":
      return scanPostEngagement(client, context);
    case "competitor_followers":
    case "competitor_audience":
      return scanCompetitorAudience(client, context);
    case "keyword_intent":
      return scanPosts(client, context, false);
    case "active_poster":
      return scanPosts(client, context, true);
    case "new_in_role":
    case "job_changes":
    case "internal_promotion":
      return scanRoleChanges(client, context);
    case "hiring_spree":
      return scanCompanies(client, context, false);
    case "company_growth":
      return scanCompanies(client, context, true);
    case "profile_viewers":
      return scanSalesNavigatorPeople(client, context);
    default:
      throw new SignalScanError(`El tipo de señal ${context.monitor.type} aún no tiene una fuente real compatible`, "unsupported_capability", false);
  }
}

export function accountHasSalesNavigator(connectionParams?: Record<string, unknown>): boolean {
  const serialized = JSON.stringify(connectionParams || {}).toLowerCase();
  return serialized.includes("sales_navigator") || serialized.includes("sales navigator");
}
