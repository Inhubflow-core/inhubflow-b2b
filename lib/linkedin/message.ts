import type { Page } from "playwright";
import { visitProfile } from "./visit";
import { isLinkedInAuthenticationWall, LinkedInAuthenticationError } from "./auth-wall";

export class NotConnectedError extends Error {}

/**
 * Raised when the send sequence ran but LinkedIn never confirmed the message
 * landed in the thread. Distinct from a hard failure: the step must NOT be
 * recorded as delivered, and is safe to retry.
 */
export class MessageNotDeliveredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageNotDeliveredError";
  }
}

/**
 * Raised when the recipient's profile could not be verified at all (the page
 * never rendered its content). Not proof they are unconnected — so it must not
 * reset the stored degree — but not permission to send either. Retryable.
 */
export class ProfileVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileVerificationError";
  }
}

export interface SendMessageResult {
  messagingUrn: string | null;
  isFirstDegree: boolean;
}

/**
 * Sends a message to a LinkedIn 1st-degree connection.
 *
 * Self-contained URN resolution — does NOT depend on a prior 'visit' workflow
 * step. If messagingUrn is already cached, it's used directly (no extra page
 * load). Otherwise this does its own live profile check to fetch a fresh URN and
 * verify the target is still actually connected, immediately before sending.
 */
export async function sendMessage(
  page: Page,
  fullName: string,
  text: string,
  linkedinUrl: string,
  messagingUrn?: string | null,
  attachmentPath?: string | null,
): Promise<SendMessageResult> {
  console.log(`[message] Starting sendMessage to "${fullName}" (cached URN: ${messagingUrn || "none"})`);

  // 1. Live profile verification and data extraction
  console.log(`[message] Visiting profile: ${linkedinUrl}`);
  const resolved = await visitProfile(page, linkedinUrl);
  const activeUrn = resolved.messagingUrn || messagingUrn || null;
  console.log(`[message] Profile resolved: isFirstDegree=${resolved.isFirstDegree}, URN=${activeUrn}, name=${resolved.profileName ?? "unknown"}`);

  const candidateNames = buildSearchCandidates(fullName, resolved.profileName, linkedinUrl);
  console.log(`[message] Search candidates for recipient: ${JSON.stringify(candidateNames)}`);

  // A profile whose container never mounted tells us NOTHING about the
  // connection degree — the page may not have hydrated, or it may have been an
  // auth wall / error page we could not classify. Treating that as "probably
  // connected, proceed" is what let sends run against unverified recipients, so
  // it is a hard stop. It is retryable: the caller reschedules a degree recheck.
  if (!resolved.isFirstDegree) {
    if (resolved.evidence?.reason === "profile_main_missing") {
      throw new ProfileVerificationError(
        `No se pudo verificar el perfil de ${fullName} (la página no cargó su contenido en ${resolved.evidence.pageUrl}). No se enviará el mensaje sin confirmar que sigue siendo contacto de 1er grado.`
      );
    }
    throw new NotConnectedError(`${fullName} is not a 1st-degree connection — refusing to message`);
  }

  // 2. Since we are already ON the profile page, attempt openComposeFromProfilePage first!
  console.log(`[message] Attempting openComposeFromProfilePage while on profile (degree=${resolved.isFirstDegree})`);
  const openedOnPage = await openComposeFromProfilePage(page);
  if (openedOnPage) {
    await sendFromComposeBox(page, text, attachmentPath);
    return { messagingUrn: activeUrn, isFirstDegree: true };
  }

  // 3. Navigate directly to LinkedIn full messaging interface
  console.log(`[message] Navigating to https://www.linkedin.com/messaging/ for "${fullName}"`);
  await page.goto("https://www.linkedin.com/messaging/", {
    waitUntil: "domcontentloaded",
    timeout: 35000,
  });

  const pageUrl = page.url();
  if (isLinkedInAuthenticationWall(pageUrl)) {
    throw new LinkedInAuthenticationError(`Tu sesión de LinkedIn ha caducado o requiere re-autenticación (redirigido a ${pageUrl}). Por favor conecta tu cuenta de nuevo en Configuración usando el Código de Conexión de la extensión.`);
  }

  // Wait up to 15s for the messaging layout to mount
  await page.locator(".scaffold-layout__aside, .msg-conversations-container, input.msg-search-form__search-field, main, div[role='main']").first()
    .waitFor({ state: "attached", timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(1500);

  if (isLinkedInAuthenticationWall(page.url())) {
    throw new LinkedInAuthenticationError(`Tu sesión de LinkedIn ha caducado (redirigido a ${page.url()}). Por favor re-autentica tu cuenta en Configuración.`);
  }

  // 4. Phase 1: Search and open existing conversation (instant match for existing contacts/spouses)
  const foundExisting = await searchExistingConversation(page, candidateNames);
  if (foundExisting) {
    console.log(`[message] Existing conversation opened for "${fullName}", sending message`);
    await sendFromComposeBox(page, text, attachmentPath);
    return { messagingUrn: activeUrn, isFirstDegree: true };
  }

  // 5. Phase 2: Start new conversation thread via typeahead
  console.log(`[message] No existing conversation found — composing new thread via typeahead for "${fullName}"`);
  await sendMessageViaTypeahead(page, candidateNames, fullName, text, attachmentPath);
  return { messagingUrn: activeUrn, isFirstDegree: true };
}

function buildSearchCandidates(
  fullName: string,
  resolvedProfileName?: string | null,
  linkedinUrl?: string
): string[] {
  const candidates: string[] = [];
  const add = (name: string | null | undefined) => {
    if (!name) return;
    const clean = name.replace(/\s+/g, " ").trim();
    if (clean.length >= 2 && !candidates.some(c => c.toLowerCase() === clean.toLowerCase())) {
      candidates.push(clean);
    }
  };

  // 1. Profile display name is top priority because that's how LinkedIn formats names in messaging
  add(resolvedProfileName);

  // 2. Full name from target record
  add(fullName);

  // 3. Vanity URL slug decoded
  if (linkedinUrl) {
    const match = linkedinUrl.match(/\/in\/([^/?#]+)/i);
    if (match && match[1]) {
      const decodedVanity = decodeURIComponent(match[1])
        .replace(/[-_]/g, " ")
        .replace(/[^a-zA-ZÀ-ÿ0-9\s]/g, "")
        .trim();
      add(decodedVanity);
    }
  }

  // 4. First name
  const first = (fullName || "").trim().split(/\s+/)[0];
  if (first && first.length >= 3) {
    add(first);
  }
  if (resolvedProfileName) {
    const firstResolved = resolvedProfileName.trim().split(/\s+/)[0];
    if (firstResolved && firstResolved.length >= 3) {
      add(firstResolved);
    }
  }

  return candidates;
}

async function openComposeFromProfilePage(page: Page): Promise<boolean> {
  try {
    console.log("[message] openComposeFromProfilePage: locating message button on profile");

    // 1. Locate the top card container containing h1
    const topCard = page
      .locator("main section, div[role='main'] section, .pv-top-card, header")
      .filter({ has: page.locator("h1") })
      .first();
    const headerCard = (await topCard.count().catch(() => 0)) > 0 ? topCard : page.locator("main, div[role='main']").first();

    const msgBtn = headerCard.locator(`
      button:has-text("Enviar mensagem"),
      button:has-text("Mensagem"),
      button:has-text("Mensaje"),
      button:has-text("Message"),
      button:has-text("Enviar mensaje"),
      button:has-text("Send message"),
      a:has-text("Enviar mensagem"),
      a:has-text("Mensagem"),
      a:has-text("Mensaje"),
      a:has-text("Message"),
      button[aria-label*="mensagem" i],
      button[aria-label*="mensaje" i],
      button[aria-label*="message" i],
      a[aria-label*="mensagem" i],
      a[aria-label*="mensaje" i],
      a[aria-label*="message" i]
    `).first();

    const btnCount = await msgBtn.count().catch(() => 0);
    if (btnCount === 0 || !(await msgBtn.isVisible().catch(() => false))) {
      console.warn("[message] openComposeFromProfilePage: message button not found in header card");
      return false;
    }

    const [btnText, btnAria] = await Promise.all([
      msgBtn.innerText().catch(() => ""),
      msgBtn.getAttribute("aria-label").then((v: string | null) => v ?? "").catch(() => ""),
    ]);
    console.log(`[message] openComposeFromProfilePage: clicking "${btnText.trim()}" (aria: "${btnAria.trim()}")`);

    // Check if the button or its parent anchor points directly to a message thread
    const directHref = await msgBtn.evaluate((el: HTMLElement) => {
      const a = el.closest("a") || el.querySelector("a");
      return a ? a.getAttribute("href") : el.getAttribute("href");
    }).catch(() => null);

    if (directHref && (directHref.includes("/messaging/thread/") || directHref.includes("/messaging/compose/"))) {
      const targetUrl = directHref.startsWith("http") ? directHref : `https://www.linkedin.com${directHref}`;
      console.log(`[message] openComposeFromProfilePage: following direct conversation thread/compose link: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      const focused = await findAndFocusComposeBox(page, 10000);
      if (focused) return true;
    }

    // Prepare popup listener in case LinkedIn opens a separate window/tab
    const popupPromise = page.context().waitForEvent("page", { timeout: 2000 }).catch(() => null);

    // Scroll and click button
    await msgBtn.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
    await msgBtn.click({ delay: 50 }).catch(async () => {
      await msgBtn.click({ force: true });
    });

    // Also dispatch DOM click on self and closest anchor
    await msgBtn.evaluate((el: HTMLElement) => {
      el.click();
      const a = el.closest("a");
      if (a && a !== el) a.click();
    }).catch(() => {});

    const popupPage = await popupPromise;
    let targetPage = page;
    if (popupPage) {
      console.log("[message] openComposeFromProfilePage: popup/new page detected, switching to popup");
      targetPage = popupPage;
      await popupPage.waitForLoadState("domcontentloaded").catch(() => {});
    }

    await targetPage.waitForTimeout(1000);

    // If click navigated the page to /messaging/
    if (targetPage.url().includes("/messaging/")) {
      console.log("[message] openComposeFromProfilePage: navigated to messaging, focusing compose box");
      const focused = await findAndFocusComposeBox(targetPage, 8000);
      if (focused) return true;
    }

    // Poll for visible compose box across targetPage and all open pages
    let focused = await findAndFocusComposeBox(targetPage, 6000);
    if (focused) {
      console.log("[message] openComposeFromProfilePage: compose box successfully focused");
      return true;
    }

    console.warn("[message] openComposeFromProfilePage: compose box not visible on profile after click");
    return false;
  } catch (err) {
    console.warn("[message] openComposeFromProfilePage error:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function findAndFocusComposeBox(page: Page, timeoutMs = 6000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // 1. If conversation bubble in overlay is minimized, click header to expand
    await page.evaluate(() => {
      const minimized = document.querySelectorAll<HTMLElement>(
        ".msg-overlay-conversation-bubble--is-minimized, aside#msg-overlay.msg-overlay-container--is-minimized"
      );
      for (const b of Array.from(minimized)) {
        const header = b.querySelector<HTMLElement>(
          "header, .msg-overlay-bubble-header, button[data-control-name='overlay.toggle_conversation'], button[data-control-name='overlay.expand']"
        );
        if (header) header.click();
      }
    }).catch(() => {});

    // 2. Direct DOM scan for any visible, active contenteditable or textarea element
    const focusedViaDom = await page.evaluate(() => {
      const selectors = [
        "div.msg-form__contenteditable[contenteditable='true']",
        "div.msg-form__contenteditable",
        "div[role='textbox'].msg-form__message-texteditor",
        "div[role='textbox'][contenteditable='true']",
        "div[role='textbox']",
        "form.msg-form [contenteditable='true']",
        "form.msg-form textarea",
        ".msg-overlay-conversation-bubble [contenteditable='true']",
        ".msg-overlay-conversation-bubble textarea",
        ".msg-thread [contenteditable='true']",
        ".msg-thread textarea",
        "div[data-placeholder][contenteditable='true']",
        "div[aria-label*='mensagem' i][contenteditable='true']",
        "div[aria-label*='mensaje' i][contenteditable='true']",
        "div[aria-label*='message' i][contenteditable='true']",
        "div.ql-editor",
        "textarea.msg-form__textarea",
        "textarea[name='message']",
        "textarea[placeholder*='mensagem' i]",
        "textarea[placeholder*='mensaje' i]",
        "textarea[placeholder*='message' i]",
        "p.msg-form__contenteditable",
        "[contenteditable='true']"
      ];
      for (const sel of selectors) {
        const elements = Array.from(document.querySelectorAll<HTMLElement>(sel));
        for (const el of elements) {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none") {
            el.click();
            el.focus();
            return true;
          }
        }
      }
      return false;
    }).catch(() => false);

    if (focusedViaDom) {
      return true;
    }

    // 3. Playwright locator check across candidates
    const loc = page.locator(`
      div.msg-form__contenteditable,
      div[role='textbox'].msg-form__message-texteditor,
      div[role='textbox'],
      form.msg-form [contenteditable='true'],
      form.msg-form textarea,
      textarea.msg-form__textarea,
      [contenteditable='true']
    `);
    const count = await loc.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const item = loc.nth(i);
      if (await item.isVisible().catch(() => false)) {
        await item.click({ delay: 50 }).catch(() => {});
        await item.focus().catch(() => {});
        return true;
      }
    }

    await page.waitForTimeout(300);
  }
  return false;
}

async function searchExistingConversation(page: Page, candidateNames: string[]): Promise<boolean> {
  try {
    console.log(`[message] Searching existing conversations for: ${JSON.stringify(candidateNames)}`);

    // 1. Wait for either conversations list items or search input to appear in DOM
    const conversationListAnchor = page.locator(`
      .msg-conversations-container__conversations-list li,
      .msg-conversation-listitem,
      .msg-conversations-container__convo-item,
      li[class*='msg-conversation'],
      input.msg-search-form__search-field,
      input[placeholder*='Pesquisar' i],
      input[placeholder*='Search' i]
    `).first();
    await conversationListAnchor.waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // 2. Check if recipient is already in visible conversation items without searching
    const existingItems = page.locator(`
      .msg-conversations-container__conversations-list li,
      .msg-conversation-listitem,
      .msg-conversations-container__convo-item,
      li[class*='msg-conversation']
    `);
    const initCount = await existingItems.count().catch(() => 0);
    console.log(`[message] Initial visible conversation items: ${initCount}`);
    for (let i = 0; i < Math.min(initCount, 20); i++) {
      const item = existingItems.nth(i);
      const rowText = await item.innerText().catch(() => "");
      if (candidateNames.some(cand => resultNameMatches(rowText, cand))) {
        console.log(`[message] Match found in visible conversations: "${rowText.split('\n')[0]}"`);
        await item.click();
        await page.waitForTimeout(1500);
        const focused = await findAndFocusComposeBox(page, 8000);
        if (focused) return true;
      }
    }

    // 3. Search via the search input in the messaging sidebar
    const searchInput = page.locator(`
      input.msg-search-form__search-field,
      form.msg-search-form input,
      .msg-search-form input,
      .msg-conversations-container input,
      .scaffold-layout__aside input,
      input[placeholder*="Pesquisar" i],
      input[placeholder*="Buscar" i],
      input[placeholder*="Search" i],
      input[aria-label*="Pesquisar" i],
      input[aria-label*="Buscar" i],
      input[aria-label*="Search" i]
    `).first();

    const searchInputFound = await searchInput.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
    if (!searchInputFound || !(await searchInput.isVisible().catch(() => false))) {
      if (isLinkedInAuthenticationWall(page.url())) {
        throw new LinkedInAuthenticationError(`Tu sesión de LinkedIn ha caducado o requiere inicio de sesión (redirigido a ${page.url()}). Por favor vuelve a conectar tu cuenta en Configuración usando el Código de Conexión de la extensión.`);
      }
      const domInputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("input")).map(i => ({
          type: i.type,
          className: i.className,
          placeholder: i.placeholder,
          ariaLabel: i.getAttribute("aria-label"),
        }));
      }).catch(() => []);
      console.log(`[message] Messaging search input not found. Total inputs in DOM (${page.url()}):`, JSON.stringify(domInputs));
      return false;
    }

    for (const term of candidateNames) {
      console.log(`[message] Filtering conversations list with term: "${term}"`);
      await searchInput.click();
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(150);

      await searchInput.pressSequentially(term, { delay: 40 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2500);

      const filteredItems = page.locator(`
        .msg-conversations-container__conversations-list li,
        .msg-conversation-listitem,
        .msg-search-results li,
        .msg-conversations-container__convo-item,
        li[class*='msg-conversation']
      `);
      const fCount = await filteredItems.count().catch(() => 0);
      console.log(`[message] Filtered conversation items found: ${fCount}`);

      for (let i = 0; i < Math.min(fCount, 15); i++) {
        const item = filteredItems.nth(i);
        const rowText = await item.innerText().catch(() => "");
        if (candidateNames.some(cand => resultNameMatches(rowText, cand)) || resultNameMatches(rowText, term)) {
          console.log(`[message] Found matching conversation for "${term}": "${rowText.split('\n')[0]}"`);
          await item.click();
          await page.waitForTimeout(1500);
          const focused = await findAndFocusComposeBox(page, 8000);
          if (focused) return true;
        }
      }
    }
    return false;
  } catch (err) {
    console.warn("[message] searchExistingConversation error:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function sendMessageViaTypeahead(
  page: Page,
  candidateNames: string[],
  fullName: string,
  text: string,
  attachmentPath?: string | null,
): Promise<void> {
  console.log(`[message] Opening new message compose thread via typeahead for candidates: ${JSON.stringify(candidateNames)}`);

  // 1. Locate and trigger the compose button
  const composeBtn = page.locator(`
    a[href*="/messaging/thread/new"],
    button.msg-conversations-container__compose-btn,
    a.msg-conversations-container__compose-btn,
    button[data-control-name="compose_message"],
    .msg-conversations-container__title-actions button,
    .msg-conversations-container__title-actions a,
    button:has(svg[data-test-icon*="compose"]),
    button:has(svg[data-test-icon*="edit"]),
    a:has(svg[data-test-icon*="compose"]),
    a:has(svg[data-test-icon*="edit"]),
    button[aria-label*="mensagem" i],
    button[aria-label*="conversa" i],
    button[aria-label*="escrever" i],
    button[aria-label*="compor" i],
    button[aria-label*="redactar" i],
    button[aria-label*="compose" i],
    a[aria-label*="mensagem" i],
    a[aria-label*="conversa" i],
    a[aria-label*="escrever" i],
    a[aria-label*="compor" i],
    a[aria-label*="redactar" i],
    a[aria-label*="compose" i]
  `).first();

  const composeBtnVisible = await composeBtn.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  if (composeBtnVisible) {
    console.log("[message] Clicking new compose button");
    await composeBtn.click({ delay: 50 }).catch(async () => {
      await composeBtn.click({ force: true });
    });
    await page.waitForTimeout(1500);
  } else {
    console.log("[message] Triggering new message button via DOM helper");
    await triggerNewMessageButton(page);
    await page.waitForTimeout(1500);
  }

  // 2. Look for the recipient typeahead search field
  const searchField = page.locator(`
    input.msg-connections-typeahead__search-field,
    .msg-connections-typeahead input,
    form.msg-connections-typeahead input,
    .msg-compose input,
    input[role="combobox"][aria-label*="destinat" i],
    input[role="combobox"][placeholder*="nome" i],
    input[role="combobox"][placeholder*="nombre" i],
    input[role="combobox"][placeholder*="name" i],
    input[role="combobox"]:not(.msg-search-form__search-field),
    input[placeholder*="nome" i]:not(.msg-search-form__search-field),
    input[placeholder*="nombre" i]:not(.msg-search-form__search-field),
    input[placeholder*="name" i]:not(.msg-search-form__search-field)
  `).first();

  let searchFocused = await searchField.waitFor({ state: "visible", timeout: 8000 }).then(async () => {
    await searchField.click().catch(() => {});
    await searchField.focus().catch(() => {});
    return true;
  }).catch(() => false);

  if (!searchFocused) {
    // Try DOM scan
    searchFocused = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
      for (const input of inputs) {
        if (input.className.includes("msg-search-form")) continue;
        const rect = input.getBoundingClientRect();
        const style = window.getComputedStyle(input);
        if (rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none") {
          const pl = (input.placeholder || "").toLowerCase();
          const aria = (input.getAttribute("aria-label") || "").toLowerCase();
          const cls = (input.className || "").toLowerCase();
          const role = (input.getAttribute("role") || "").toLowerCase();
          if (
            cls.includes("typeahead") ||
            role === "combobox" ||
            pl.includes("nome") || pl.includes("nombre") || pl.includes("name") || pl.includes("digite") || pl.includes("escreva") ||
            aria.includes("nome") || aria.includes("nombre") || aria.includes("name") || aria.includes("destinat") || aria.includes("recipient")
          ) {
            input.click();
            input.focus();
            return true;
          }
        }
      }
      return false;
    }).catch(() => false);
  }

  if (!searchFocused && isLinkedInAuthenticationWall(page.url())) {
    throw new LinkedInAuthenticationError(`Tu sesión de LinkedIn ha caducado o requiere inicio de sesión (redirigido a ${page.url()}). Por favor vuelve a conectar tu cuenta en Configuración usando el Código de Conexión de la extensión.`);
  }

  let clicked = false;
  if (searchFocused) {
    for (let cIdx = 0; cIdx < candidateNames.length; cIdx++) {
      const term = candidateNames[cIdx];
      console.log(`[message] Trying typeahead search with term: "${term}"`);

      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(150);

      await page.keyboard.type(term, { delay: 50 });
      await page.waitForTimeout(2500);

      const resultRows = page.locator(`
        div[class*="msg-connections-typeahead__search-result-row"],
        li[class*="msg-connections-typeahead__result-item"],
        .msg-connections-typeahead__search-results li,
        [role="option"]
      `);

      const optCount = await resultRows.count().catch(() => 0);
      console.log(`[message] Results returned for "${term}": ${optCount}`);

      for (let i = 0; i < optCount; i++) {
        const opt = resultRows.nth(i);
        if (await opt.isVisible().catch(() => false)) {
          const textContent = (await opt.innerText().catch(() => "")).trim();
          if (candidateNames.some(cand => resultNameMatches(textContent, cand)) || resultNameMatches(textContent, term)) {
            console.log(`[message] Matching recipient found in results: "${textContent}"`);
            await opt.click({ delay: 100 });
            clicked = true;
            break;
          }
        }
      }

      if (clicked) break;

      if (!clicked && optCount === 1) {
        const single = resultRows.first();
        if (await single.isVisible().catch(() => false)) {
          console.log("[message] Selecting sole result returned by typeahead");
          await single.click({ delay: 100 });
          clicked = true;
          break;
        }
      }
    }
    await page.waitForTimeout(1500);
  }

  if (!searchFocused || !clicked) {
    throw new Error(`Could not find or select recipient "${fullName}" in LinkedIn messaging — aborting to prevent false delivery`);
  }

  await sendFromComposeBox(page, text, attachmentPath);
}

async function triggerNewMessageButton(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const direct = document.querySelector<HTMLElement>(
        'a[href*="/messaging/thread/new"], button.msg-conversations-container__compose-btn, [data-control-name="compose_message"]'
      );
      if (direct) {
        direct.click();
        return true;
      }
      const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, a"));
      for (const b of buttons) {
        const aria = (b.getAttribute("aria-label") || "").toLowerCase();
        const href = (b.getAttribute("href") || "").toLowerCase();
        if (
          href.includes("/messaging/thread/new") ||
          aria.includes("mensaje nuevo") ||
          aria.includes("nuevo mensaje") ||
          aria.includes("crear un mensaje") ||
          aria.includes("escribir un mensaje") ||
          aria.includes("redactar") ||
          aria.includes("compose") ||
          aria.includes("nova mensagem") ||
          aria.includes("escrever") ||
          aria.includes("compor") ||
          aria.includes("nova conversa") ||
          b.querySelector('svg[data-test-icon*="compose"], svg[data-test-icon*="edit"], li-icon[type*="compose"], li-icon[type*="edit"]')
        ) {
          b.click();
          return true;
        }
      }
      return false;
    });
  } catch {
    return false;
  }
}

export function resultNameMatches(resultText: string, targetName: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const target = normalize(targetName);
  const result = normalize(resultText);
  if (!target || !result) return false;
  if (result.includes(target)) return true;

  const targetWords = target.split(" ").filter(w => w.length > 1);
  if (targetWords.length > 1 && targetWords.every(w => result.includes(w))) {
    return true;
  }
  const firstTarget = targetWords[0];
  if (firstTarget && firstTarget.length >= 3) {
    const regex = new RegExp(`(?:^|\\s)${firstTarget}(?:$|\\s)`, "i");
    if (regex.test(result)) return true;
  }
  return false;
}

async function attachFileInCompose(page: Page, filePath: string): Promise<boolean> {
  try {
    const isDoc = /\.pdf|\.doc|\.docx|\.xls|\.xlsx|\.txt/i.test(filePath);
    const fileInputs = page.locator("input[type='file']");
    const count = await fileInputs.count();
    let uploaded = false;

    if (count > 0) {
      if (isDoc) {
        const docBtn = page.locator("button.msg-form__attachment-btn--doc, button[aria-label*='document'], button[aria-label*='archivo'], button[aria-label*='documento']").first();
        if (await docBtn.isVisible().catch(() => false)) {
          await docBtn.click().catch(() => {});
          await page.waitForTimeout(1000);
        }
      }

      for (let i = 0; i < count; i++) {
        try {
          await fileInputs.nth(i).setInputFiles(filePath);
          uploaded = true;
          break;
        } catch { /* continue */ }
      }
    }

    if (uploaded) {
      await page.waitForTimeout(2500);

      // Confirm LinkedIn document upload modal if present
      const modalPrimaryBtn = page.locator(`
        .artdeco-modal button.artdeco-button--primary,
        .share-promoted-document-modal__primary-button,
        div[role='dialog'] button:has-text('Done'),
        div[role='dialog'] button:has-text('Listo'),
        div[role='dialog'] button:has-text('Hecho'),
        div[role='dialog'] button:has-text('Continuar'),
        div[role='dialog'] button:has-text('Save'),
        div[role='dialog'] button:has-text('Guardar'),
        div[role='dialog'] button:has-text('Concluir'),
        div[role='dialog'] button:has-text('Salvar'),
        div[role='dialog'] button:has-text('Pronto')
      `).first();

      if (await modalPrimaryBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
        await modalPrimaryBtn.click({ delay: 100 });
        await page.waitForTimeout(2000);
      }
      return true;
    }
    return false;
  } catch (err) {
    console.warn("[attachFileInCompose] error attaching file:", err);
    return false;
  }
}

async function sendFromComposeBox(page: Page, text: string, attachmentPath?: string | null): Promise<void> {
  // 1. If attachment present, attach it first
  if (attachmentPath) {
    await attachFileInCompose(page, attachmentPath);
  }

  // 2. Focus and enter text message into compose area
  if (text?.trim()) {
    console.log("[message] Focusing compose box for text entry");
    const focused = await findAndFocusComposeBox(page, 8000);
    if (!focused) {
      throw new Error("LinkedIn compose box not found or not focused — aborting to prevent false delivery");
    }

    // Try clipboard paste first
    try {
      await page.evaluate((t) => navigator.clipboard.writeText(t), text);
      await page.waitForTimeout(200);
      await page.keyboard.press("Control+V");
      await page.waitForTimeout(300);
    } catch {
      /* continue to verification */
    }

    // Check if text was actually inserted into the active contenteditable
    const hasText = await page.evaluate(() => {
      const active = document.activeElement;
      return active ? (active.textContent || "").trim().length > 0 : false;
    }).catch(() => false);

    if (!hasText) {
      console.log("[message] Direct typing message text into compose box");
      await page.keyboard.type(text, { delay: 10 });
      await page.waitForTimeout(400);
    }

    // Trigger input and change events so LinkedIn's React/Ember app enables the Send button
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active) {
        active.dispatchEvent(new Event("input", { bubbles: true }));
        active.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const allBoxes = document.querySelectorAll("div.msg-form__contenteditable, [contenteditable='true']");
      for (const box of Array.from(allBoxes)) {
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }).catch(() => {});
    await page.waitForTimeout(600);
  }

  // 3. Multi-strategy send dispatch
  console.log("[message] Dispatching send action");
  let sentViaDom = false;

  // Strategy A: DOM submit on form or send button
  sentViaDom = await page.evaluate(() => {
    // 1. Look for submit button inside active message form
    const forms = Array.from(document.querySelectorAll<HTMLFormElement>("form.msg-form, .msg-overlay-conversation-bubble form, .msg-thread form, form"));
    for (const form of forms) {
      const btn = form.querySelector<HTMLButtonElement>(
        'button[type="submit"], button.msg-form__send-button, button.msg-form__send-btn, footer button.artdeco-button--primary, button[data-control-name="send_message"]'
      );
      if (btn) {
        btn.removeAttribute("disabled");
        btn.disabled = false;
        btn.click();
        return true;
      }
    }

    // 2. Scan all buttons on page for send intent
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
    for (const b of buttons) {
      const aria = (b.getAttribute("aria-label") || "").toLowerCase();
      const text = (b.innerText || "").trim().toLowerCase();
      const type = b.getAttribute("type");
      const hasIcon = !!b.querySelector('svg[data-test-icon*="send"], li-icon[type*="send"]');
      if (
        (type === "submit" && (b.className.includes("msg") || b.closest("footer, form"))) ||
        aria.includes("enviar") ||
        aria.includes("send") ||
        text === "enviar" ||
        text === "send" ||
        hasIcon
      ) {
        const rect = b.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          b.removeAttribute("disabled");
          b.disabled = false;
          b.click();
          return true;
        }
      }
    }
    return false;
  }).catch(() => false);

  if (sentViaDom) {
    console.log("[message] Send button clicked via DOM successfully");
  } else {
    // Strategy B: Playwright locator fallback
    const sendLocator = page.locator(`
      form.msg-form button[type='submit'],
      button.msg-form__send-button,
      button.msg-form__send-btn,
      footer button.artdeco-button--primary,
      button:has(svg[data-test-icon*='send']),
      button:has-text("Enviar"),
      button:has-text("Send")
    `);

    const count = await sendLocator.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const b = sendLocator.nth(i);
      if (await b.isVisible().catch(() => false)) {
        if (await b.isDisabled().catch(() => false)) {
          await page.keyboard.press("Space");
          await page.keyboard.press("Backspace");
          await page.waitForTimeout(300);
        }
        await b.click({ delay: 50 }).catch(() => {});
        console.log("[message] Send button clicked via Playwright locator");
        break;
      }
    }
  }

  // Strategy C: Keyboard shortcuts — Control+Enter is the universal shortcut in LinkedIn to send
  console.log("[message] Sending keyboard send shortcut (Control+Enter)");
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3000);

  // 4. Confirm delivery. Clicking *a* send button is not evidence the message
  // left the browser: the click may hit a disabled control, the thread may not
  // have been open, or LinkedIn may have dropped the draft. Without this check
  // the step reports "Message sent" whenever nothing threw, which is exactly
  // how a message can be marked delivered while the recipient never got it.
  await assertMessageDelivered(page, text);
  console.log("[message] Send sequence completed and delivery confirmed");
}

/**
 * Verifies a just-sent message actually landed in the thread.
 *
 * Two independent signals, both required to be consistent with a send:
 *  - the compose box is now EMPTY (LinkedIn clears it only on successful send),
 *  - the message text appears in the conversation transcript.
 * Either one alone can be misleading, so we accept the send when the transcript
 * shows the text, or when the box cleared and no draft remains.
 */
async function assertMessageDelivered(page: Page, text: string): Promise<void> {
  const expected = (text || "").trim();
  if (!expected) return; // attachment-only send — nothing textual to confirm

  // Compare on a normalized, reasonably distinctive slice of the message.
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const needle = normalize(expected).slice(0, 60);

  const deadline = Date.now() + 12_000;
  let composeEmpty = false;
  let transcriptHasText = false;

  while (Date.now() < deadline) {
    const state = await page.evaluate((needleArg: string) => {
      const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

      const boxes = Array.from(
        document.querySelectorAll<HTMLElement>("div.msg-form__contenteditable, [contenteditable='true']")
      ).filter((box) => {
        const rect = box.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const draftRemaining = boxes.some((box) => norm(box.textContent || "").length > 0);

      const transcript = document.querySelector<HTMLElement>(
        ".msg-s-message-list-content, .msg-s-message-list, .msg-overlay-conversation-bubble__content, .msg-thread"
      );
      const transcriptText = norm(transcript?.innerText || "");

      return {
        boxCount: boxes.length,
        draftRemaining,
        transcriptHasText: needleArg.length > 0 && transcriptText.includes(needleArg),
      };
    }, needle).catch(() => null);

    if (state) {
      composeEmpty = state.boxCount > 0 && !state.draftRemaining;
      transcriptHasText = state.transcriptHasText;
      if (transcriptHasText) return;
      if (composeEmpty) break;
    }
    await page.waitForTimeout(1000);
  }

  if (transcriptHasText || composeEmpty) return;

  // The draft is still sitting in the box (or we could not read the thread at
  // all): treat as NOT delivered so the caller can retry rather than record a
  // phantom send.
  throw new MessageNotDeliveredError(
    `LinkedIn no confirmó la entrega del mensaje (el borrador sigue en el cuadro de redacción en ${page.url()}). No se marcará como enviado.`
  );
}
