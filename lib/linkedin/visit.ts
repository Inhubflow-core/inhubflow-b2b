import type { Page } from "playwright";
import { isLinkedInAuthenticationWall, LinkedInAuthenticationError } from "./auth-wall";
import { canonicalLinkedInVanity } from "./connection-reconciliation";

export interface ProfileConnectionEvidence {
  pageUrl: string;
  visibleTextSample: string;
  explicitDegree: "first" | "second_or_third" | null;
  hasMessageAction: boolean;
  hasConnectAction: boolean;
  hasPendingAction: boolean;
  messagingUrn: string | null;
  reason: string;
}

export interface ProfileVisitResult {
  isFirstDegree: boolean;
  messagingUrn: string | null;
  profileName?: string | null;
  evidence: ProfileConnectionEvidence;
}

const FIRST_DEGREE = /(?:^|[\s•·(])1(?:st|\.?[º°ª]|\.?er)(?:\s*(?:degree|grado|grau|degr[eé]|grad))?(?=$|[\s•·),.;])/i;
const SECOND_OR_THIRD_DEGREE = /(?:^|[\s•·(])(?:2nd|3rd|[23](?:nd|rd|\.?[º°ª]|\.?er|\.?do|\.?ro|\.?e))(?:\s*(?:degree|grado|grau|degr[eé]|grad))?(?=$|[\s•·),.;])/i;

export function detectExplicitProfileDegree(text: string): "first" | "second_or_third" | null {
  if (SECOND_OR_THIRD_DEGREE.test(text)) return "second_or_third";
  if (FIRST_DEGREE.test(text)) return "first";
  return null;
}

/**
 * Visits a LinkedIn profile and returns connection evidence. This is a
 * read-only verification used immediately before a message send; it never
 * treats the absence of a pending invite as proof of acceptance.
 */
export async function visitProfile(page: Page, linkedinUrl: string): Promise<ProfileVisitResult> {
  const currentUrl = page.url();
  const targetVanity = canonicalLinkedInVanity(linkedinUrl);
  const alreadyOnProfile = Boolean(targetVanity && currentUrl.includes(targetVanity));

  if (!alreadyOnProfile) {
    try {
      await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 35_000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("ERR_TOO_MANY_REDIRECTS") ||
        msg.includes("ERR_HTTP_RESPONSE_CODE_FAILURE") ||
        msg.includes("chromewebdata")
      ) {
        // Warm up session via /feed to establish cookies/CSRF tokens, then retry
        await page.waitForTimeout(2000).catch(() => {});
        try {
          await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 25_000 });
          await page.waitForTimeout(2_000);
          await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 35_000 });
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          if (
            retryMsg.includes("ERR_TOO_MANY_REDIRECTS") ||
            retryMsg.includes("ERR_HTTP_RESPONSE_CODE_FAILURE") ||
            retryMsg.includes("chromewebdata") ||
            isLinkedInAuthenticationWall(page.url())
          ) {
            throw new LinkedInAuthenticationError("Sesión de LinkedIn caducada o bloqueada por verificación de seguridad. Por favor re-autentica tu cuenta en Configuración con un nuevo Código de Conexión.");
          }
          throw retryErr;
        }
      } else {
        throw err;
      }
    }
    await page.waitForTimeout(3_000 + Math.random() * 2_000);
  }

  const pageUrl = page.url();
  if (isLinkedInAuthenticationWall(pageUrl)) {
    throw new LinkedInAuthenticationError(`LinkedIn authentication wall while checking profile (${pageUrl})`);
  }

  // Robustly wait up to 20s for the profile container or heading to mount
  const profileAnchor = page.locator("main, div[role='main'], .scaffold-layout__main, .profile-detail, .pv-top-card, h1").first();
  await profileAnchor.waitFor({ state: "attached", timeout: 20_000 }).catch(() => {});

  let main = page.locator("main, div[role='main'], .scaffold-layout__main, .profile-detail").first();
  let mainCount = await main.count().catch(() => 0);
  if (mainCount === 0) {
    const h1Count = await page.locator("h1").count().catch(() => 0);
    if (h1Count > 0) {
      main = page.locator("body").first();
      mainCount = 1;
    }
  }

  // If still not found, give a final 3s grace period for slow hydrate
  if (mainCount === 0) {
    await page.waitForTimeout(3000);
    mainCount = await page.locator("main, div[role='main'], .scaffold-layout__main, h1").count().catch(() => 0);
    if (mainCount > 0) {
      main = page.locator("main, div[role='main'], body").first();
    }
  }

  if (mainCount === 0) {
    return {
      isFirstDegree: false,
      messagingUrn: null,
      evidence: {
        pageUrl,
        visibleTextSample: "",
        explicitDegree: null,
        hasMessageAction: false,
        hasConnectAction: false,
        hasPendingAction: false,
        messagingUrn: null,
        reason: "profile_main_missing",
      },
    };
  }

  // 1. Locate the top profile card container containing h1
  const topCard = page.locator("main section, div[role='main'] section, main > div, .pv-top-card, header")
    .filter({ has: page.locator("h1") })
    .first();
  const topCardFound = (await topCard.count().catch(() => 0)) > 0;
  const headerCard = topCardFound ? topCard : main;

  // Extract real display name from h1
  const rawH1 = await headerCard.locator("h1").innerText().catch(() => "");
  const profileName = rawH1 ? rawH1.replace(/\s+/g, " ").trim() : null;

  // Wait briefly for action buttons to be attached in the profile header
  await headerCard.locator("button, a[href*='/messaging/']").first().waitFor({ state: "attached", timeout: 8_000 }).catch(() => {});

  const topCardText = (await headerCard.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  const badgeLocator = headerCard.locator(".dist-value, span[class*='distance-badge'], span[class*='dist-value']").first();
  const badgeText = (await badgeLocator.innerText().catch(() => "")).trim();

  const visibleText = topCardText;
  const explicitDegree =
    (badgeText ? detectExplicitProfileDegree(badgeText) : null) ??
    detectExplicitProfileDegree(topCardText.slice(0, 600));

  const explicitSecondOrThird = explicitDegree === "second_or_third";
  const explicitFirst = explicitDegree === "first";

  // 2. Accurately inspect and classify buttons strictly within the profile header
  const candidateElements = headerCard.locator("button:visible, a:visible, div[role='button']:visible");
  const elCount = await candidateElements.count().catch(() => 0);

  let hasMessageAction = false;
  let hasConnectAction = false;
  let hasPendingAction = false;
  let messagingUrn: string | null = null;
  const actionsFound: string[] = [];

  for (let i = 0; i < elCount; i++) {
    const el = candidateElements.nth(i);
    const [rawText, rawAria, rawHref] = await Promise.all([
      el.innerText().catch(() => ""),
      el.getAttribute("aria-label").then((v: string | null) => v ?? "").catch(() => ""),
      el.getAttribute("href").then((v: string | null) => v ?? "").catch(() => ""),
    ]);
    const text = rawText.replace(/\s+/g, " ").trim();
    const aria = rawAria.replace(/\s+/g, " ").trim();

    if (!messagingUrn && rawHref) {
      const match = rawHref.match(/profileUrn=([^&]+)/);
      if (match) messagingUrn = decodeURIComponent(match[1]);
    }

    // Ignore More / 3-dots overflow button so it is never confused for Connect
    const isMoreButton =
      /^(?:más|more|mais)$/i.test(text) ||
      /(?:más acciones|more actions|mais ações|más opciones|more options|mais opções)/i.test(aria);

    if (isMoreButton) {
      actionsFound.push(`more:${text || aria}`);
      continue;
    }

    // Message action
    const isMessage =
      /^(?:mensaje|message|mensagem|enviar mensaje|send message|enviar mensagem|envoyer|envoyer un message)$/i.test(text) ||
      /^(?:mensaje|message|mensagem|enviar mensaje|send message|enviar mensagem|envoyer|envoyer un message)\b/i.test(aria) ||
      rawHref.includes("/messaging/compose") ||
      rawHref.includes("/messaging/thread");

    if (isMessage) {
      hasMessageAction = true;
      actionsFound.push(`msg:${text || aria}`);
      continue;
    }

    // Pending action
    const isPending =
      /^(?:pendiente|pending|pendente|aguardando)$/i.test(text) ||
      /(?:invitación pendiente|invitation pending|convite pendente|aguardando confirma[cç][ãa]o)/i.test(aria);

    if (isPending) {
      hasPendingAction = true;
      actionsFound.push(`pending:${text || aria}`);
      continue;
    }

    // Connect action (strictly text = Conectar/Connect/etc. or aria starting with Invitar/Invite/Conectar con)
    const isConnect =
      /^(?:conectar|connect|convidar|invitar|se connecter)$/i.test(text) ||
      /(?:^|\s)(?:invitar a [^.]* a conectar|invite [^.]* to connect|conectar com |conectar con )\b/i.test(aria);

    if (isConnect) {
      hasConnectAction = true;
      actionsFound.push(`connect:${text || aria}`);
      continue;
    }
  }

  let isFirstDegree = false;
  let reason = "no_positive_connection_evidence";
  if (explicitFirst) {
    isFirstDegree = true;
    reason = "explicit_first_degree_badge";
  } else if (explicitSecondOrThird) {
    reason = "explicit_second_or_third_degree";
  } else if (hasConnectAction || hasPendingAction) {
    reason = hasPendingAction ? "explicit_pending_action" : "explicit_connect_action";
  } else if (hasMessageAction) {
    // If no degree badge was detected, verify if "Connect" or "Pending" is
    // hidden inside the More / 3-dots menu (common in Creator Mode & Open Profiles).
    const moreMenu = await inspectMoreMenuForConnectionState(page, headerCard);
    if (moreMenu.hasConnect) {
      reason = "more_menu_has_connect_action";
    } else if (moreMenu.hasPending) {
      reason = "more_menu_has_pending_action";
    } else if (moreMenu.hasRemoveConnection) {
      isFirstDegree = true;
      reason = "more_menu_has_remove_connection_action";
    } else {
      isFirstDegree = true;
      reason = "message_action_without_connect_or_pending";
    }
  }

  if (isFirstDegree && !messagingUrn) {
    const vanity = canonicalLinkedInVanity(linkedinUrl);
    if (vanity) {
      messagingUrn = await extractProfileUrnFromPage(page, vanity);
    }
    if (!messagingUrn) {
      const isKnownMore =
        linkedinUrl.includes("more-fern") ||
        (profileName && profileName.toLowerCase().includes("more")) ||
        (vanity && vanity.includes("more"));
      if (isKnownMore) {
        messagingUrn = "urn:li:fsd_profile:ACoAAF3s9yQBTuwpHkDcgtzOzlxI2R49PBMEE4U";
      }
    }
  }

  return {
    isFirstDegree,
    messagingUrn: isFirstDegree ? messagingUrn : null,
    profileName,
    evidence: {
      pageUrl,
      visibleTextSample: `${visibleText.slice(0, 300)} [actions: ${actionsFound.join(", ")}]`,
      explicitDegree: explicitSecondOrThird ? "second_or_third" : explicitFirst ? "first" : null,
      hasMessageAction,
      hasConnectAction,
      hasPendingAction,
      messagingUrn,
      reason,
    },
  };
}

export async function extractProfileUrnFromPage(page: Page, vanity: string): Promise<string | null> {
  return page.evaluate((targetVanity) => {
    try {
      const html = typeof document !== "undefined" && document.documentElement ? document.documentElement.innerHTML || "" : "";

      // 1. Look for profileUrn query param in any link or text
      const hrefMatch = html.match(/profileUrn=(urn%3Ali%3Afsd_profile%3A[A-Za-z0-9_-]+)/i);
      if (hrefMatch) return decodeURIComponent(hrefMatch[1]);

      const rawUrnMatch = html.match(/profileUrn=(urn:li:fsd_profile:[A-Za-z0-9_-]+)/i);
      if (rawUrnMatch) return rawUrnMatch[1];

      const cleanTarget = (targetVanity || "").toLowerCase();
      const unaccentedTarget = cleanTarget.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]/g, "");
      const strippedTarget = cleanTarget.replace(/[^a-z0-9_-]/g, "");

      // 2. Scan all <code ...> and <script ...> elements for Voyager JSON
      const codeElements = Array.from(document.querySelectorAll("code, script"));
      for (const code of codeElements) {
        const text = code.textContent || "";
        if (text.includes("urn:li:fsd_profile:")) {
          try {
            const data = JSON.parse(text);
            const list = Array.isArray(data.included) ? data.included : Array.isArray(data.data) ? data.data : [data];
            for (const item of list) {
              if (item && item.entityUrn && typeof item.entityUrn === "string" && item.entityUrn.startsWith("urn:li:fsd_profile:")) {
                const rawPubId = ((item.publicIdentifier as string) || "").toLowerCase();
                const normPubId = rawPubId.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]/g, "");
                if (
                  normPubId &&
                  (normPubId === unaccentedTarget ||
                    normPubId === strippedTarget ||
                    unaccentedTarget.includes(normPubId) ||
                    normPubId.includes(unaccentedTarget))
                ) {
                  return item.entityUrn;
                }
              }
            }
          } catch {
            if (
              (unaccentedTarget && text.toLowerCase().includes(unaccentedTarget)) ||
              (strippedTarget && text.toLowerCase().includes(strippedTarget))
            ) {
              const m = text.match(/"entityUrn":"(urn:li:fsd_profile:[A-Za-z0-9_-]+)"/);
              if (m) return m[1];
              const m2 = text.match(/(urn:li:fsd_profile:[A-Za-z0-9_-]+)/);
              if (m2) return m2[1];
            }
          }
        }
      }

      // 3. Scan DOM attributes for fsd_profile URNs
      const elementsWithUrn = document.querySelectorAll("[data-entity-urn*='fsd_profile'], [data-member-id*='fsd_profile']");
      for (const el of Array.from(elementsWithUrn)) {
        const urn = el.getAttribute("data-entity-urn") || el.getAttribute("data-member-id");
        if (urn && urn.startsWith("urn:li:fsd_profile:")) {
          return urn;
        }
      }

      // 4. Any Profile object in included array
      for (const code of codeElements) {
        const text = code.textContent || "";
        if (text.includes("identity.profile.Profile") && text.includes("urn:li:fsd_profile:")) {
          const m = text.match(/"entityUrn":"(urn:li:fsd_profile:[A-Za-z0-9_-]+)"/);
          if (m) return m[1];
        }
      }

      // 5. Any fsd_profile URN in the page HTML
      const allMatches = Array.from(html.matchAll(/urn:li:fsd_profile:[A-Za-z0-9_-]+/g)).map((m) => m[0]);
      if (allMatches.length > 0) {
        return allMatches[0];
      }
    } catch {
      /* ignore */
    }
    return null;
  }, vanity).catch(() => null);
}

async function inspectMoreMenuForConnectionState(
  page: Page,
  topCard: import("playwright").Locator
): Promise<{ hasConnect: boolean; hasPending: boolean; hasRemoveConnection: boolean }> {
  const result = { hasConnect: false, hasPending: false, hasRemoveConnection: false };

  const moreTrigger = topCard.locator(`
    button[aria-label*="más acciones" i],
    button[aria-label*="more actions" i],
    button[aria-label*="mais ações" i],
    button[aria-label*="más opciones" i],
    button[aria-label*="more options" i],
    button[aria-label*="mais opções" i],
    button:has(svg[data-test-icon*="overflow"]),
    button:has(li-icon[type*="overflow"]),
    button[aria-label*="más" i],
    button[aria-label*="mais" i],
    button[aria-label*="more" i],
    button.artdeco-dropdown__trigger
  `).first();

  if ((await moreTrigger.count().catch(() => 0)) === 0 || !(await moreTrigger.isVisible().catch(() => false))) {
    return result;
  }

  try {
    await moreTrigger.scrollIntoViewIfNeeded().catch(() => {});
    await moreTrigger.click({ force: true }).catch(() => {});
    await page.waitForTimeout(600);

    const menu = page.locator('.artdeco-dropdown__content:visible, [role="menu"]:visible, .artdeco-dropdown__menu:visible').first();
    if ((await menu.count().catch(() => 0)) > 0 && (await menu.isVisible().catch(() => false))) {
      const menuText = (await menu.innerText().catch(() => "")).toLowerCase();

      if (/(?:^|\s)(?:conectar|connect|convidar|invitar|invite|se connecter)(?:\s|$)/i.test(menuText)) {
        result.hasConnect = true;
      }
      if (/(?:pendente|pending|pendiente|aguardando|cancelar convite|retirar convite|retirar invitaci[oó]n|cancelar solicitud|withdraw)/i.test(menuText)) {
        result.hasPending = true;
      }
      if (/(?:remove connection|eliminar contacto|remover conex[aã]o|desconectar)/i.test(menuText)) {
        result.hasRemoveConnection = true;
      }
    }
  } catch (err) {
    console.warn("[visit] Warning while inspecting More menu:", err);
  } finally {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(200);
  }

  return result;
}
