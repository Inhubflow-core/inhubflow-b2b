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
import type { SignalType } from "@/lib/signals/schema";
import type { DiscoveredSignalLead, SignalScanResult, SignalScannerContext } from "./contracts";
import { SignalScanError } from "./contracts";
import { canonicalLinkedInProfileUrl, evidenceFingerprint, extractCompanyFromHeadline } from "./scoring";
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

  // 1. Si ya viene como un URN completo de LinkedIn (urn:li:activity:..., urn:li:ugcPost:..., urn:li:share:...)
  const directUrnMatch = decoded.match(/urn:li:(?:activity|share|ugcPost):([0-9]{10,25})/i);
  if (directUrnMatch) {
    const fullUrn = decoded.match(/(urn:li:(?:activity|share|ugcPost):[0-9]{10,25})/i);
    if (fullUrn) return fullUrn[1];
    return `urn:li:activity:${directUrnMatch[1]}`;
  }

  // 2. Si contiene prefijos de tipo y dígitos (activity-724..., ugcPost-724..., share-724...)
  const typedPrefix = decoded.match(/(activity|share|ugcPost)[-:_]([0-9]{10,25})/i);
  if (typedPrefix) {
    const type = typedPrefix[1].toLowerCase();
    const digits = typedPrefix[2];
    if (type === "ugcpost") return `urn:li:ugcPost:${digits}`;
    return `urn:li:activity:${digits}`;
  }

  // 3. URLs de updates, posts, shares
  const updateMatch = decoded.match(/(?:update|posts|shares)\/(?:urn:li:[a-z]+:)?([0-9]{10,25})/i);
  if (updateMatch) return `urn:li:activity:${updateMatch[1]}`;

  // 4. Fallback: secuencia de 10 a 25 dígitos -> convertir a urn:li:activity:
  const digitsMatch = decoded.match(/([0-9]{10,25})/);
  if (digitsMatch) return `urn:li:activity:${digitsMatch[1]}`;

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
  profileImageUrl?: string | null;
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
    profileImageUrl: input.profileImageUrl || null,
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
    profileImageUrl:
      item.profile_picture_url ||
      (item as any).picture_url ||
      (item as any).profile_picture_url_large ||
      (item as any).image_url ||
      null,
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

// Límite máximo seguro por página para búsquedas de posts en Unipile (evita sobrepasar límites del proveedor)
const MAX_POST_SEARCH_LIMIT = 49;

async function postSearch(client: SignalScannerClient, context: SignalScannerContext, body: Record<string, unknown>): Promise<{ posts: UnipileSearchPost[]; cursor?: string | null }> {
  const response = await client.searchLinkedIn({
    account_id: context.remoteAccountId,
    api: "classic",
    category: "posts",
    limit: Math.min(context.limit, MAX_POST_SEARCH_LIMIT),
    cursor: context.cursor?.cursor || undefined,
    ...body,
  });
  return { posts: response.items.filter(isPost), cursor: response.cursor };
}

async function fetchPostItemsWithFallback<T>(
  fetchFn: (urn: string) => Promise<{ items: T[] }>,
  primaryUrn: string
): Promise<{ items: T[] }> {
  const digits = primaryUrn.match(/([0-9]{10,25})/)?.[1];
  const urnVariants: string[] = [primaryUrn];
  if (digits) {
    const altActivity = `urn:li:activity:${digits}`;
    const altShare = `urn:li:share:${digits}`;
    const altUgc = `urn:li:ugcPost:${digits}`;
    if (!urnVariants.includes(altActivity)) urnVariants.push(altActivity);
    if (!urnVariants.includes(altShare)) urnVariants.push(altShare);
    if (!urnVariants.includes(altUgc)) urnVariants.push(altUgc);
  }

  for (const variant of urnVariants) {
    try {
      const res = await fetchFn(variant);
      if (res?.items && Array.isArray(res.items) && res.items.length > 0) {
        return res;
      }
    } catch (err) {
      const status = typeof err === "object" && err !== null && "status" in err ? (err as { status?: number }).status : undefined;
      console.warn(`[SignalRadar] Fallback URN error en ${variant} (status ${status || "unknown"}):`, err instanceof Error ? err.message : String(err));
    }
  }

  return { items: [] };
}

function parseCommentLead(
  comment: any,
  monitorId: string,
  signalType: string,
  sourceType: string,
  postUrl: string,
  fallbackSnippet?: string
): DiscoveredSignalLead | null {
  const authorObj = typeof comment.author === "object" && comment.author !== null ? comment.author : {};
  const authorDetails = comment.author_details || {};
  const authorName = (
    typeof comment.author === "string"
      ? comment.author
      : authorObj.name || `${authorObj.first_name || ""} ${authorObj.last_name || ""}`.trim() || authorDetails.name
  )?.trim();
  const profileUrlVal = authorDetails.profile_url || authorObj.profile_url || authorDetails.public_profile_url || authorObj.public_profile_url || null;
  const headlineVal = authorDetails.headline || authorObj.headline || null;
  const authorIdVal = authorDetails.id || authorObj.id || null;
  const publicIdVal = authorDetails.public_identifier || authorObj.public_identifier || null;
  const commentText = comment.text || "";
  const commentDate = comment.date || comment.created_at || null;
  const snippet = commentText ? `Comentó: “${commentText.slice(0, 240)}”` : (fallbackSnippet || "Comentó en la publicación");

  return authorLead({
    monitorId,
    signalType,
    sourceType,
    sourceId: comment.id,
    sourceUrl: postUrl,
    occurredAt: commentDate,
    snippet,
    id: authorIdVal,
    publicIdentifier: publicIdVal,
    name: authorName,
    headline: headlineVal,
    explicitProfileUrl: profileUrlVal,
    profileImageUrl:
      authorObj.picture_url ||
      authorObj.profile_picture_url ||
      authorObj.profile_picture_url_large ||
      authorDetails.picture_url ||
      authorDetails.profile_picture_url ||
      null,
    metadata: { commentId: comment.id, postUrl },
  });
}

function parseReactionLead(
  reaction: any,
  monitorId: string,
  signalType: string,
  sourceType: string,
  postUrn: string,
  postUrl: string,
  fallbackSnippet?: string
): DiscoveredSignalLead | null {
  const authorObj = reaction.author || {};
  const authorName = (
    authorObj.name || `${authorObj.first_name || ""} ${authorObj.last_name || ""}`.trim()
  )?.trim();
  const profileUrlVal = authorObj.profile_url || authorObj.public_profile_url || null;
  const headlineVal = authorObj.headline || null;
  const reactionKind = reaction.value || reaction.reaction_type || "LIKE";
  const snippet = fallbackSnippet || `Reaccionó (${reactionKind}) a la publicación`;

  return authorLead({
    monitorId,
    signalType,
    sourceType,
    sourceId: reaction.id || `${postUrn}:${authorObj.id || authorName}:${reactionKind}`,
    sourceUrl: postUrl,
    occurredAt: new Date().toISOString(),
    snippet,
    id: authorObj.id || null,
    publicIdentifier: authorObj.public_identifier || null,
    name: authorName,
    headline: headlineVal,
    explicitProfileUrl: profileUrlVal,
    profileImageUrl:
      authorObj.picture_url ||
      authorObj.profile_picture_url ||
      authorObj.profile_picture_url_large ||
      authorObj.picture ||
      null,
    metadata: { reactionType: reactionKind, postUrl },
  });
}

async function scanPostEngagement(client: SignalScannerClient, context: SignalScannerContext): Promise<SignalScanResult> {
  const targetUrls = parseTargetUrls(context.monitor.target_url);
  if (targetUrls.length === 0) {
    throw new SignalScanError("Se requiere al menos una URL válida de publicación de LinkedIn", "invalid_configuration", false);
  }

  const postsToScan = targetUrls.slice(0, 15);
  const limitPerPost = Math.max(10, Math.floor(context.limit / Math.max(1, postsToScan.length)));
  const leads: DiscoveredSignalLead[] = [];
  const seenFingerprints = new Set<string>();

  for (const postUrl of postsToScan) {
    const urn = postIdentifier(postUrl);
    if (!urn) continue;

    const shouldFetchComments = context.monitor.type !== "competitor_reactions";
    const shouldFetchReactions = context.monitor.type !== "high_intent_comments";

    const [comments, reactions] = await Promise.all([
      shouldFetchComments
        ? fetchPostItemsWithFallback((u) => client.getPostComments(u, context.remoteAccountId, limitPerPost), urn)
        : Promise.resolve({ items: [] }),
      shouldFetchReactions
        ? fetchPostItemsWithFallback((u) => client.getPostReactions(u, context.remoteAccountId, limitPerPost), urn)
        : Promise.resolve({ items: [] }),
    ]);

    const signalTypeComment = context.monitor.type === "post_engagement" ? "post_engagement" : "high_intent_comments";
    for (const comment of comments.items || []) {
      const lead = parseCommentLead(comment, context.monitor.id, signalTypeComment, "post_comment", postUrl);
      if (lead && !seenFingerprints.has(lead.evidence.fingerprint)) {
        seenFingerprints.add(lead.evidence.fingerprint);
        leads.push(lead);
      }
    }

    const signalTypeReaction = context.monitor.type === "post_engagement" ? "post_engagement" : "competitor_reactions";
    for (const reaction of reactions.items || []) {
      const lead = parseReactionLead(reaction, context.monitor.id, signalTypeReaction, "post_reaction", urn, postUrl);
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

  let datePosted: "past_24h" | "past_week" | "past_month" | undefined;
  if (activeOnly) {
    datePosted = "past_week";
  } else {
    const days = context.icp.time_window_days || 30;
    if (days <= 1) datePosted = "past_24h";
    else if (days <= 7) datePosted = "past_week";
    else if (days <= 30) datePosted = "past_month";
    else datePosted = undefined;
  }

  const { posts, cursor } = await postSearch(client, context, {
    keywords: query,
    sort_by: "date",
    ...(datePosted ? { date_posted: datePosted } : {}),
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
  const seenFingerprints = new Set<string>();

  for (const post of posts.slice(0, 3)) {
    const postUrn = postIdentifier(post.social_id || post.share_url || post.id);
    if (!postUrn) continue;
    const [comments, reactions] = await Promise.all([
      fetchPostItemsWithFallback((u) => client.getPostComments(u, context.remoteAccountId, Math.min(context.limit, 25)), postUrn),
      fetchPostItemsWithFallback((u) => client.getPostReactions(u, context.remoteAccountId, Math.min(context.limit, 25)), postUrn),
    ]);
    for (const comment of comments.items || []) {
      const lead = parseCommentLead(
        comment,
        context.monitor.id,
        "competitor_audience",
        "competitor_post_comment",
        post.share_url || "",
        `Comentó en contenido relacionado con ${subject}`
      );
      if (lead && !seenFingerprints.has(lead.evidence.fingerprint)) {
        seenFingerprints.add(lead.evidence.fingerprint);
        leads.push(lead);
      }
    }
    for (const reaction of reactions.items || []) {
      const lead = parseReactionLead(
        reaction,
        context.monitor.id,
        "competitor_audience",
        "competitor_post_reaction",
        postUrn,
        post.share_url || "",
        `Interactuó con contenido relacionado con ${subject}`
      );
      if (lead && !seenFingerprints.has(lead.evidence.fingerprint)) {
        seenFingerprints.add(lead.evidence.fingerprint);
        leads.push(lead);
      }
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

      const headline = profile.headline || post.author?.headline || "";
      const inferredCompany = extractCompanyFromHeadline(headline);
      const company = current?.company || inferredCompany || null;

      // Determinación de promoción interna:
      // 1. Por historial de work_experience si está disponible
      // 2. O por texto del post si anuncia explícitamente ascenso interno cuando la experiencia está vacía
      let internal = false;
      if (current?.company && prior?.company) {
        internal = current.company.toLowerCase() === prior.company.toLowerCase();
      } else {
        const postText = (post.text || "").toLowerCase();
        internal = /promoted\s+to|ascendido\s+a|promovido\s+a|nuevo\s+rol\s+dentro\s+de|nueva\s+posici[oó]n\s+en/i.test(postText);
      }

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
        publicIdentifier: profile.public_identifier || post.author?.public_identifier,
        name: `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || post.author?.name,
        headline: headline || current?.position || null,
        explicitProfileUrl: profile.public_profile_url || profile.profile_url || url,
        metadata: {
          currentRole: current || null,
          previousRole: prior || null,
          internalPromotion: internal,
          throttledExperience: Boolean(profile.throttled_sections?.includes("experience") || !profile.work_experience?.length),
          resolvedProfile: profile,
        },
      });
      if (lead) {
        lead.company = company;
        lead.location = profile.location || current?.location || null;
        leads.push(lead);
      }
    } catch {
      // A profile that cannot be verified is not emitted as a role-change lead.
    }
  }
  return { leads, cursor: { cursor } };
}

export async function resolveLocationIds(client: SignalScannerClient, context: SignalScannerContext): Promise<string[]> {
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

async function peopleAtCompanies(
  client: SignalScannerClient,
  context: SignalScannerContext,
  companies: UnipileSearchCompany[],
  signalType: string,
  locationIds: string[] = []
): Promise<DiscoveredSignalLead[]> {
  const leads: DiscoveredSignalLead[] = [];
  for (const company of companies.slice(0, 5)) {
    const response = await client.searchLinkedIn({
      account_id: context.remoteAccountId,
      api: context.hasSalesNavigator ? "sales_navigator" : "classic",
      category: "people",
      limit: Math.min(10, context.limit),
      ...(context.hasSalesNavigator
        ? {
            company: { include: [company.id] },
            ...(context.icp.titles?.length ? { keywords: context.icp.titles.join(" OR ") } : {}),
            ...(locationIds.length ? { location: { include: locationIds } } : {}),
          }
        : {
            company: [company.id],
            ...(context.icp.titles?.length ? { advanced_keywords: { title: context.icp.titles.join(" OR ") } } : {}),
            ...(locationIds.length ? { location: locationIds } : {}),
          }),
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
  const leads = await peopleAtCompanies(client, context, companies, growth ? "company_growth" : "hiring_spree", locationIds);
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

  const nonWebEventKinds = (context.icp.event_kinds || []).filter((k) => !webTypes.includes(k));
  if (nonWebEventKinds.length > 1) {
    const results = await Promise.allSettled(
      nonWebEventKinds.map((type) => scanSingleSignalType(client, context, type))
    );
    const successful = results
      .filter((r): r is PromiseFulfilledResult<SignalScanResult> => r.status === "fulfilled")
      .map((r) => r.value);
    if (successful.length > 0) return mergeScanResults(successful, context.limit);
    const reason = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw reason?.reason instanceof Error ? reason.reason : new SignalScanError("Ninguna de las fuentes de señales seleccionadas respondió", "provider_error", true);
  }

  return scanSingleSignalType(client, context, context.monitor.type);
}

async function scanSingleSignalType(
  client: SignalScannerClient,
  context: SignalScannerContext,
  signalType: string,
): Promise<SignalScanResult> {
  const currentContext: SignalScannerContext = {
    ...context,
    monitor: { ...context.monitor, type: signalType as SignalType },
  };
  switch (signalType) {
    case "competitor_reactions":
    case "high_intent_comments":
    case "post_engagement":
      return scanPostEngagement(client, currentContext);
    case "competitor_followers":
    case "competitor_audience":
      return scanCompetitorAudience(client, currentContext);
    case "keyword_intent":
      return scanPosts(client, currentContext, false);
    case "active_poster":
      return scanPosts(client, currentContext, true);
    case "new_in_role":
    case "job_changes":
    case "internal_promotion":
      return scanRoleChanges(client, currentContext);
    case "hiring_spree":
      return scanCompanies(client, currentContext, false);
    case "company_growth":
      return scanCompanies(client, currentContext, true);
    case "profile_viewers":
      return scanSalesNavigatorPeople(client, currentContext);
    default:
      throw new SignalScanError(`El tipo de señal ${signalType} aún no tiene una fuente real compatible`, "unsupported_capability", false);
  }
}

export function accountHasSalesNavigator(connectionParams?: Record<string, unknown>): boolean {
  if (!connectionParams || typeof connectionParams !== "object") return false;
  // 1. Verificación precisa en premiumFeatures o premium_features de Unipile
  const features = connectionParams.premiumFeatures || connectionParams.premium_features;
  if (Array.isArray(features)) {
    return features.some((f) => typeof f === "string" && f.toLowerCase().includes("sales_navigator"));
  }
  // 2. Flags booleanos explícitos
  if (connectionParams.sales_navigator === true || connectionParams.salesNavigator === true) {
    return true;
  }
  return false;
}
