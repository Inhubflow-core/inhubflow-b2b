import type { Page } from "playwright";

const AUTH_WALL_PATTERN = /\/login|\/authwall|\/checkpoint|\/uas\//i;
const PUBLIC_SIGN_IN_SELECTOR = [
  "#public_profile_contextual-sign-in",
  '[data-tracking-control-name="public_profile_contextual-sign-in"]',
  ".contextual-sign-in-modal",
].join(",");

export class LinkedInAuthenticationError extends Error {
  constructor(
    message = "LinkedIn authentication is no longer valid",
    readonly submissionAttempted = false
  ) {
    super(message);
    this.name = "LinkedInAuthenticationError";
  }
}

export function isLinkedInAuthenticationWall(url: string): boolean {
  return AUTH_WALL_PATTERN.test(url);
}

/**
 * Outcome of an auth-wall probe.
 *  - "wall"          → LinkedIn positively refused the session.
 *  - "authenticated" → the feed loaded as a logged-in user.
 *  - "indeterminate" → the probe itself failed (timeout / network / dead page).
 *
 * "indeterminate" exists because collapsing it into "authenticated" is what
 * turns a dead session into an error loop: the probe times out, the caller
 * concludes the session is fine, and the runner keeps working an account that
 * LinkedIn has already logged out. Callers must treat it as "unknown — stop and
 * retry later", never as proof of either state.
 */
export type LinkedInAuthWallProbe = "wall" | "authenticated" | "indeterminate";

/**
 * Confirms an API authorization failure against a separate, user-facing page.
 * Voyager may return 401/403 for CSRF, endpoint or rate-limit reasons while the
 * browser session itself is still valid, so those statuses cannot log an
 * account out on their own.
 */
export async function probeLinkedInAuthenticationWall(page: Page): Promise<LinkedInAuthWallProbe> {
  try {
    const startUrl = page.url();
    if (isLinkedInAuthenticationWall(startUrl)) {
      console.warn(`[auth-wall] Probe: start URL matches auth wall: ${startUrl}`);
      return "wall";
    }
    let navigationFailed = false;
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    }).catch((e: any) => {
      navigationFailed = true;
      console.warn(`[auth-wall] Probe navigation warning: ${e instanceof Error ? e.message : String(e)}`);
    });
    await page.waitForTimeout(1500);
    const feedUrl = page.url();
    if (isLinkedInAuthenticationWall(feedUrl)) {
      console.warn(`[auth-wall] Probe: feed redirected to auth wall: ${feedUrl}`);
      return "wall";
    }
    const publicSignIn = (await page.locator(PUBLIC_SIGN_IN_SELECTOR).count().catch(() => 0)) > 0;
    if (publicSignIn) {
      console.warn(`[auth-wall] Probe: public sign-in prompt detected on ${feedUrl}`);
      return "wall";
    }
    if (navigationFailed) {
      // The navigation never completed (timeout / network / dead page), so we
      // never actually saw the feed and know nothing either way. This is the
      // case that used to be reported as "session healthy" and kept the runner
      // hammering an account LinkedIn had already logged out.
      console.warn(`[auth-wall] Probe: inconclusive — feed navigation did not complete (${feedUrl})`);
      return "indeterminate";
    }
    console.log(`[auth-wall] Probe: feed confirmed authenticated (${feedUrl})`);
    return "authenticated";
  } catch {
    // A network/browser failure is not evidence either way — and must not be
    // read as a healthy session.
    return "indeterminate";
  }
}
