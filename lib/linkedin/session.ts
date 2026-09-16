import type { Browser, BrowserContext, BrowserContextOptions, Page } from "playwright";
import { getDb } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { LinkedInAuthenticationError } from "./auth-wall";
import { linkedInDefaultUserAgent } from "./cookie-state";

let browser: Browser | null = null;
const contexts: Map<string, BrowserContext> = new Map();

const HEADLESS = process.env.HEADLESS !== "false";
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-blink-features=AutomationControlled",
];

/** Single source of truth for the fallback UA — see linkedInDefaultUserAgent(). */
const DEFAULT_USER_AGENT = linkedInDefaultUserAgent();

type BrowserStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
type PersistedStorageState = BrowserStorageState & { userAgent?: string };

/**
 * Shared browser-context fingerprint. Login and runtime MUST use the identical
 * options so the LinkedIn session is BORN under the exact fingerprint it will
 * later be used with — a mismatch (or a drift) triggers a forced re-auth.
 */
function contextOptions(storageState?: PersistedStorageState, accountTimezone?: string | null): BrowserContextOptions {
  const customUserAgent =
    (typeof storageState?.userAgent === "string" && storageState.userAgent) ||
    DEFAULT_USER_AGENT;

  const timezoneId = (accountTimezone && accountTimezone !== "UTC") ? accountTimezone : "America/Sao_Paulo";
  const locale = timezoneId.includes("Sao_Paulo") ? "pt-BR" : (timezoneId.includes("Madrid") || timezoneId.includes("Bogota") || timezoneId.includes("Mexico") ? "es-ES" : "en-US");

  return {
    storageState,
    viewport: { width: 1920, height: 1080 },
    userAgent: customUserAgent,
    locale,
    timezoneId,
    permissions: ["clipboard-read", "clipboard-write"] as ("clipboard-read" | "clipboard-write")[],
    extraHTTPHeaders: {
      "sec-ch-ua-platform": '"Windows"',
    },
  };
}

async function getBrowser(_headless = HEADLESS): Promise<Browser> {
  throw new Error("El navegador local fue retirado. Usa la conexión cloud de LinkedIn.");
}

async function getOrCreateContext(accountId: string): Promise<BrowserContext> {
  const db = getDb();
  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId) as
    | { cookies_json: string | null; email: string; timezone?: string; is_authenticated?: number }
    | undefined;

  if (!account) throw new Error(`Account ${accountId} not found`);

  // markNeedsReauth() clears is_authenticated but deliberately keeps
  // cookies_json (it holds the pinned UA needed for the next connect). Without
  // this guard, any caller that reaches getSessionPage without checking the
  // flag would happily rebuild a context from those dead cookies and re-enter
  // the fail loop. Refuse here so the account stays paused until reconnected.
  if (account.is_authenticated !== 1 && !contexts.has(accountId)) {
    throw new LinkedInAuthenticationError(
      `La cuenta de LinkedIn ${accountId} requiere re-autenticación. Conéctala de nuevo en Configuración con un nuevo Código de Conexión.`
    );
  }

  if (!contexts.has(accountId)) {
    const b = await getBrowser();

    let storageState: PersistedStorageState | undefined;
    if (account.cookies_json) {
      try {
        const parsed = JSON.parse(decryptSecret(account.cookies_json)!) as PersistedStorageState;
        const cookies = Array.isArray(parsed?.cookies) ? parsed.cookies : [];
        const hasLiAt = cookies.some((cookie: unknown) => {
          if (!cookie || typeof cookie !== "object") return false;
          const candidate = cookie as { name?: unknown; value?: unknown };
          return candidate.name === "li_at" && typeof candidate.value === "string" && candidate.value.length > 20;
        });
        if (hasLiAt) {
          const seen = new Set<string>();
          const deduped: Array<any> = [];
          for (const c of (cookies as Array<any>)) {
            if (!c || typeof c !== "object" || !c.name) continue;
            if (c.name === "__cf_bm" || c.name === "cf_clearance" || String(c.name).startsWith("_cf")) continue;
            let domain = c.domain || ".linkedin.com";
            if (!domain.startsWith(".")) domain = "." + domain;
            if (!domain.includes("linkedin.com")) domain = ".linkedin.com";
            if (!seen.has(c.name)) {
              seen.add(c.name);
              deduped.push({ ...c, domain, path: c.path || "/" });
            }
          }
          storageState = {
            ...parsed,
            cookies: deduped,
          };
        } else {
          // A syntactically valid storage state without li_at cannot authenticate
          // LinkedIn. Do not leave the account looking connected while the
          // runner repeatedly creates empty contexts.
          db.prepare("UPDATE accounts SET is_authenticated = 0 WHERE id = ?").run(accountId);
        }
      } catch {
        // Invalid storage state — require re-authentication rather than keeping
        // a stale authenticated flag.
        if ((account as any).extension_active !== 1) {
          db.prepare("UPDATE accounts SET is_authenticated = 0 WHERE id = ?").run(accountId);
        }
      }
    }

    const ctx = await b.newContext(contextOptions(storageState, account.timezone));
    await ctx.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "platform", { get: () => "Win32" });
        if ((navigator as any).userAgentData) {
          Object.defineProperty((navigator as any).userAgentData, "platform", { get: () => "Windows" });
        }
      } catch { /* ignore */ }
    });

    // Auto-evict from map when context closes for any reason (crash, session expiry, etc.)
    ctx.on("close", () => { if (contexts.get(accountId) === ctx) contexts.delete(accountId); });

    contexts.set(accountId, ctx);
  }

  return contexts.get(accountId)!;
}

/** Returns the BrowserContext for an account (for API calls via ctx.request) */
export async function getSessionContext(accountId: string): Promise<BrowserContext> {
  try {
    return await getOrCreateContext(accountId);
  } catch (err) {
    // A needs-reauth account will fail identically on retry — surface it now so
    // the caller pauses instead of burning a second browser launch.
    if (err instanceof LinkedInAuthenticationError) throw err;
    // First attempt failed — evict and retry once with a fresh context
    contexts.delete(accountId);
    return getOrCreateContext(accountId);
  }
}

// B6 (Jul 2026 CPU-spike incident): closing a Playwright page doesn't mean the
// underlying Chromium renderer OS process has actually exited — under CPU
// contention on the 2-vCPU prod box, teardown was observed lagging 60-90s
// behind page.close(). If the runner loop (or a concurrent MCP/API call)
// opens its next page immediately after, two renderer processes end up alive
// at once, which is enough to peg both cores and starve sibling containers'
// healthchecks (NocoDB/Chatwoot flapping). Fix: serialize ALL page opens
// app-wide through one queue, and hold the queue for a teardown buffer after
// each page.close() before letting the next one through. PAGE_MAX_HOLD_MS is
// a safety valve so a caller that forgets to close its page can't wedge the
// whole app's browser access forever.
const PAGE_TEARDOWN_GAP_MS = 3000;
const PAGE_MAX_HOLD_MS = 120_000;
let pageQueueTail: Promise<void> = Promise.resolve();

/** Returns a new Page from the account's browser context */
export async function getSessionPage(accountId: string): Promise<Page> {
  let releaseTurn!: () => void;
  const myTurn = new Promise<void>(r => { releaseTurn = r; });
  const previousTail = pageQueueTail;
  pageQueueTail = myTurn;
  await previousTail;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseTurn();
  };
  const safetyTimer = setTimeout(release, PAGE_MAX_HOLD_MS);

  let page: Page;
  try {
    const ctx = await getOrCreateContext(accountId);
    try {
      page = await ctx.newPage();
    } catch {
      // B2: context was dead — CLOSE it before recreating so its underlying
      // browser process isn't left orphaned, then retry once with a fresh one.
      try { await ctx.close(); } catch { /* already gone */ }
      contexts.delete(accountId);
      const freshCtx = await getOrCreateContext(accountId);
      page = await freshCtx.newPage();
    }
  } catch (err) {
    clearTimeout(safetyTimer);
    release();
    throw err;
  }

  const originalClose = page.close.bind(page);
  page.close = (async (options?: Parameters<Page["close"]>[0]) => {
    try {
      return await originalClose(options);
    } finally {
      clearTimeout(safetyTimer);
      setTimeout(release, PAGE_TEARDOWN_GAP_MS);
    }
  }) as Page["close"];

  return page;
}

export async function saveSessionState(accountId: string): Promise<void> {
  const ctx = contexts.get(accountId);
  if (!ctx) return;
  const db = getDb();
  const state = await ctx.storageState();
  const cleanCookies = (state.cookies || []).filter(
    (c: { name: string; value: string }) => c.name !== "__cf_bm" && c.name !== "cf_clearance" && !c.name.startsWith("_cf")
  );
  const hasLiAt = cleanCookies.some((cookie: { name: string; value: string }) =>
    cookie.name === "li_at" && typeof cookie.value === "string" && cookie.value.length > 20
  );
  if (!hasLiAt) {
    console.warn(`[session] refusing to persist account ${accountId} without a valid li_at cookie`);
    return;
  }

  // ctx.storageState() does NOT include userAgent, so writing it back verbatim
  // would silently DROP the UA captured when the account was connected and
  // revert this session to DEFAULT_USER_AGENT on the next context build. That
  // is a fingerprint change mid-session, which LinkedIn answers by revoking
  // li_at. Carry the pinned UA forward on every save.
  const persisted: PersistedStorageState = { ...state, cookies: cleanCookies };
  const previousUserAgent = readPersistedUserAgent(db, accountId);
  if (previousUserAgent) persisted.userAgent = previousUserAgent;

  // Persisting a live browser context is not proof that LinkedIn accepted the
  // session. Only explicit authentication flows may set is_authenticated=1.
  db.prepare("UPDATE accounts SET cookies_json = ? WHERE id = ?").run(
    encryptSecret(JSON.stringify(persisted)),
    accountId
  );
}

/** Reads the UA pinned in the account's stored storageState, if any. */
function readPersistedUserAgent(db: ReturnType<typeof getDb>, accountId: string): string | null {
  try {
    const row = db.prepare("SELECT cookies_json FROM accounts WHERE id = ?").get(accountId) as
      | { cookies_json: string | null }
      | undefined;
    if (!row?.cookies_json) return null;
    const parsed = JSON.parse(decryptSecret(row.cookies_json)!) as PersistedStorageState;
    return typeof parsed?.userAgent === "string" && parsed.userAgent.length > 10 ? parsed.userAgent : null;
  } catch {
    return null;
  }
}

export async function closeSession(accountId: string): Promise<void> {
  const ctx = contexts.get(accountId);
  if (ctx) {
    await ctx.close();
    contexts.delete(accountId);
  }
}

/**
 * B4: flag an account as logged out / needing re-auth. Clears is_authenticated
 * so the runner stops working a dead session (no more 30s-timeout fail-loop),
 * and drops the live context. The user re-authenticates from Settings.
 */
export async function markNeedsReauth(accountId: string): Promise<void> {
  const db = getDb();
  db.prepare("UPDATE accounts SET is_authenticated = 0 WHERE id = ?").run(accountId);
  try { await closeSession(accountId); } catch { /* ignore */ }
  console.warn(`[session] account ${accountId} flagged needs-reauth`);
}

/**
 * Opens a visible browser, navigates to LinkedIn login, and waits for the user
 * to complete login manually. Returns when the user reaches /feed.
 * Saves the full storage state to DB and marks account as authenticated.
 */
export async function authenticateAccount(_accountId: string): Promise<void> {
  throw new Error("La autenticación local fue retirada. Conecta la cuenta mediante el acceso seguro de LinkedIn.");
}

// ─── Server-side headless login ───────────────────────────────────────────────
// Logs in directly on the server (no screen) so the session is born under the
// SAME pinned Chromium fingerprint the runner uses, and so ALL cookies — incl.
// httpOnly ones like li_ep_auth_context (the Sales Nav seat cookie that
// document.cookie cannot read) — are captured. A login from a datacenter IP
// almost always triggers an email/SMS PIN, so it's a two-step flow: start
// (email+password) → maybe a challenge → verify (code).

export type LoginResult =
  | { status: "authenticated" }
  | { status: "challenge"; kind: "otp" | "app" | "captcha" | "unknown"; message: string }
  | { status: "error"; message: string };

type PendingLogin = { ctx: BrowserContext; page: Page; createdAt: number };
const pendingLogins: Map<string, PendingLogin> = new Map();
const PENDING_TTL_MS = 10 * 60_000;

// PIN/verification-code input. Named ids first, then type-based fallbacks for
// LinkedIn's React checkpoint pages (which use dynamic ids). Safe: the login
// page itself has no tel/one-time-code input to misfire on.
const PIN_SELECTOR =
  "input[name='pin'], #input__email_verification_pin, input[autocomplete='one-time-code']:visible, input[type='tel']:visible";

async function clearPendingLogin(accountId: string): Promise<void> {
  const p = pendingLogins.get(accountId);
  if (p) {
    pendingLogins.delete(accountId);
    try { await p.ctx.close(); } catch { /* already gone */ }
  }
}

function sweepPendingLogins(): void {
  const now = Date.now();
  for (const [id, p] of pendingLogins) {
    if (now - p.createdAt > PENDING_TTL_MS) void clearPendingLogin(id);
  }
}

/**
 * Warm the freshly-authenticated session by loading Sales Navigator once, THEN
 * persist. The bare login POST lands on /feed and only mints the ~11 core
 * LinkedIn cookies — it does NOT yet include the Sales Nav SEAT cookie
 * (li_ep_auth_context) nor the secondary auth tokens (li_a, liap) and
 * localStorage. Those are only issued once the browser actually enters Sales
 * Navigator. Without the seat cookie every Sales Nav API call returns nothing
 * ("no intercept after 15s" → import fails → account wrongly flagged
 * needs-reauth). So we navigate to /sales/ and wait for it to settle before
 * calling storageState(), capturing the FULL session the runner needs.
 * Best-effort: if the account has no Sales Nav seat the nav simply doesn't add
 * the seat cookie — the rest of the (regular-LinkedIn) session is still saved.
 */
async function persistLogin(accountId: string, ctx: BrowserContext, page?: Page): Promise<void> {
  if (page) {
    try {
      await page.goto("https://www.linkedin.com/sales/home", { waitUntil: "domcontentloaded", timeout: 30_000 });
      // Let Sales Nav's bootstrap requests fire so li_ep_auth_context is set.
      await page.waitForTimeout(4_000);
    } catch {
      // Non-fatal — a missing seat / slow load must not fail the whole login.
    }
  }
  const db = getDb();
  const state = await ctx.storageState();
  // Pin the UA this session was actually born under (see saveSessionState).
  const persisted: PersistedStorageState = { ...state, userAgent: DEFAULT_USER_AGENT };
  db.prepare("UPDATE accounts SET cookies_json = ?, is_authenticated = 1 WHERE id = ?").run(
    encryptSecret(JSON.stringify(persisted)),
    accountId
  );
  // Drop any stale runtime context so the runner reloads the fresh cookies.
  await closeSession(accountId);
}

/**
 * Inspect the page after a login/verify submit and classify the outcome.
 * LinkedIn varies its challenge per attempt — email/SMS code OR device (app)
 * approval — so we detect both: a visible code input = otp; a checkpoint page
 * with no code input and no captcha = device approval.
 */
async function classifyLoginState(page: Page): Promise<LoginResult> {
  const start = Date.now();
  const deadline = start + 20_000;
  while (Date.now() < deadline) {
    const url = page.url();
    if (/\/feed\//.test(url) || /linkedin\.com\/sales\//.test(url)) {
      return { status: "authenticated" };
    }

    // Check for CAPTCHA (Arkose / FunCaptcha) anywhere on page
    const cap = page.locator("iframe[src*='arkoselabs'], iframe[title*='captcha'], #captcha-internal, div[data-litms-control-urn*='captcha']");
    if ((await cap.count().catch(() => 0)) > 0) {
      return {
        status: "challenge",
        kind: "captcha",
        message: "LinkedIn requiere verificación de seguridad (CAPTCHA) al iniciar sesión desde el servidor. Usa la pestaña 'Paste cookies' para conectar tu cuenta de forma 100% segura.",
      };
    }

    // Email/SMS PIN entry
    const pin = page.locator(PIN_SELECTOR).first();
    if ((await pin.count()) > 0 && (await pin.isVisible().catch(() => false))) {
      return {
        status: "challenge",
        kind: "otp",
        message: "LinkedIn envió un código de verificación (a tu correo o SMS). Ingrésalo a continuación.",
      };
    }

    if (/checkpoint\/challenge/.test(url)) {
      // Device/app approval: a settled checkpoint with no code input and no captcha
      if (Date.now() - start > 4_000) {
        return {
          status: "challenge",
          kind: "app",
          message: "LinkedIn envió una notificación de inicio de sesión a tu app móvil de LinkedIn. Apruébala en tu teléfono y haz clic en Continuar.",
        };
      }
    }

    // Check for visible inline error messages (wrong password, account not found, etc.)
    const errorEl = page.locator("#error-for-username, #error-for-password, .alert-content, div[role='alert'], .form__label--error, p.alert, .input-error").first();
    if ((await errorEl.count().catch(() => 0)) > 0 && (await errorEl.isVisible().catch(() => false))) {
      const errTxt = await errorEl.textContent().catch(() => "");
      if (errTxt && errTxt.trim().length > 3) {
        return { status: "error", message: errTxt.trim() };
      }
    }

    // Multilingual wrong credentials check
    const wrongPw = await page
      .getByText(/that.?s not the right password|please enter a valid|couldn.?t find a linkedin account|contraseña incorrecta|no es la contraseña correcta|no hemos podido encontrar|senha incorreta|não está correta/i)
      .count()
      .catch(() => 0);
    if (wrongPw > 0) return { status: "error", message: "Correo o contraseña incorrectos en LinkedIn." };

    await page.waitForTimeout(800);
  }

  if (/checkpoint/.test(page.url())) {
    return {
      status: "challenge",
      kind: "unknown",
      message: "LinkedIn solicitó una verificación de seguridad. Si recibiste un código ingrésalo; si es aprobación en tu móvil, confírmalo y haz clic en Continuar.",
    };
  }

  if (/linkedin\.com\/login/i.test(page.url())) {
    return {
      status: "error",
      message: "LinkedIn bloqueó el inicio de sesión directo por seguridad (IP de servidor detectada). Usa la pestaña 'Paste cookies' para conectar tu cuenta de inmediato sin bloqueos.",
    };
  }

  return { status: "error", message: `No se completó el inicio de sesión. Página actual: ${page.url()}` };
}

export async function startHeadlessLogin(
  accountId: string,
  email: string,
  password: string
): Promise<LoginResult> {
  sweepPendingLogins();
  await clearPendingLogin(accountId);

  const b = await getBrowser(true);
  const ctx = await b.newContext(contextOptions());
  const page = await ctx.newPage();
  try {
    await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded", timeout: 30_000 });

    const emailInput = page.locator("input#username, input[type='email']:visible").first();
    await emailInput.waitFor({ state: "visible", timeout: 20_000 });
    await emailInput.fill(email);

    const passwordInput = page.locator("input#password, input[type='password']:visible").first();
    await passwordInput.fill(password);

    await page.waitForTimeout(500);

    // Locate and click the explicit Submit button (crucial for modern LinkedIn SPA)
    const submitBtn = page.locator("button[type='submit'], button[data-litms-control-urn='login-submit'], button:has-text('Sign in'), button:has-text('Iniciar sesión'), button:has-text('Entrar')").first();
    if ((await submitBtn.count().catch(() => 0)) > 0 && (await submitBtn.isVisible().catch(() => false))) {
      await submitBtn.click().catch(() => {});
    } else {
      await passwordInput.press("Enter").catch(() => {});
    }

    await page.waitForLoadState("domcontentloaded").catch(() => {});

    const result = await classifyLoginState(page);
    console.log(`[login] start account=${accountId} -> ${result.status}${"kind" in result ? "/" + result.kind : ""} url=${page.url()}`);
    if (result.status === "authenticated") {
      await persistLogin(accountId, ctx, page);
      await ctx.close();
      return result;
    }
    if (result.status === "challenge" && result.kind !== "captcha") {
      pendingLogins.set(accountId, { ctx, page, createdAt: Date.now() });
      return result;
    }
    await ctx.close();
    return result;
  } catch (e) {
    console.log(`[login] start account=${accountId} ERROR ${(e as Error).message} url=${page.url()}`);
    try { await ctx.close(); } catch { /* ignore */ }
    return { status: "error", message: (e as Error).message };
  }
}

export async function submitLoginChallenge(accountId: string, code: string): Promise<LoginResult> {
  const p = pendingLogins.get(accountId);
  if (!p) return { status: "error", message: "No login in progress (it may have timed out — start again)." };

  const { ctx, page } = p;
  try {
    const pin = page.locator(PIN_SELECTOR).first();
    await pin.waitFor({ state: "visible", timeout: 15_000 });
    await pin.fill(code);
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      pin.press("Enter"),
    ]);

    const result = await classifyLoginState(page);
    console.log(`[login] verify account=${accountId} -> ${result.status}${"kind" in result ? "/" + result.kind : ""} url=${page.url()}`);
    if (result.status === "authenticated") {
      await persistLogin(accountId, ctx, page);
      await clearPendingLogin(accountId);
      return result;
    }
    if (result.status === "challenge" && result.kind !== "captcha") {
      p.createdAt = Date.now(); // keep the session alive for another step
      return result;
    }
    await clearPendingLogin(accountId);
    return result.status === "error"
      ? result
      : { status: "error", message: "Code rejected or login failed." };
  } catch (e) {
    await clearPendingLogin(accountId);
    return { status: "error", message: (e as Error).message };
  }
}

/**
 * Wait for a device/app-approval challenge to clear. Called after the user
 * approves the sign-in in their LinkedIn mobile app — the checkpoint page then
 * auto-advances to the feed. Also dismisses a possible "remember this browser?"
 * interstitial. If still pending, returns the challenge so the user can retry.
 */
export async function awaitLoginApproval(accountId: string): Promise<LoginResult> {
  const p = pendingLogins.get(accountId);
  if (!p) return { status: "error", message: "No login in progress (it may have timed out — start again)." };

  const { ctx, page } = p;
  p.createdAt = Date.now();
  try {
    const reachedFeed = await page
      .waitForURL(/\/feed\/|linkedin\.com\/sales\//, { timeout: 50_000 })
      .then(() => true)
      .catch(() => false);

    if (!reachedFeed) {
      // Possible post-approval interstitial (e.g. "remember this browser?")
      const btn = page
        .locator("button[type=submit]:visible, button:has-text('Yes'):visible, button:has-text('Ja'):visible")
        .first();
      if ((await btn.count().catch(() => 0)) > 0) {
        await btn.click().catch(() => {});
        await page.waitForURL(/\/feed\/|linkedin\.com\/sales\//, { timeout: 20_000 }).catch(() => {});
      }
    }

    const result = await classifyLoginState(page);
    console.log(`[login] await account=${accountId} -> ${result.status}${"kind" in result ? "/" + result.kind : ""} url=${page.url()}`);
    if (result.status === "authenticated") {
      await persistLogin(accountId, ctx, page);
      await clearPendingLogin(accountId);
      return result;
    }
    if (result.status === "challenge" && result.kind !== "captcha") {
      p.createdAt = Date.now();
      return result;
    }
    await clearPendingLogin(accountId);
    return result;
  } catch (e) {
    await clearPendingLogin(accountId);
    return { status: "error", message: (e as Error).message };
  }
}
