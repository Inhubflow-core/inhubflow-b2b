const Database = require('better-sqlite3');
const { chromium } = require('playwright');
const { createDecipheriv, hkdfSync } = require('crypto');

const secret = process.env.NEXTAUTH_SECRET || "b7e199f1d8c7e909a32c2560ef718e8749a2a91283e74c10";
function deriveKey(info = "inhubflow-secret-encryption") {
  return Buffer.from(hkdfSync("sha256", secret, "", info, 32));
}

function decryptSecret(value) {
  if (!value) return null;
  if (!value.startsWith("v1:")) return value;
  const [, ivB64, authTagB64, dataB64] = value.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");

  try {
    const key = deriveKey("inhubflow-secret-encryption");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (err1) {
    try {
      const legacyKey = deriveKey("linki-secret-encryption");
      const decipher = createDecipheriv("aes-256-gcm", legacyKey, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return plaintext.toString("utf8");
    } catch (err2) {
      return null;
    }
  }
}

async function testStatus() {
  const db = new Database("linki.db");
  const acc = db.prepare("SELECT * FROM accounts LIMIT 1").get();
  const dec = decryptSecret(acc.cookies_json);
  const storageState = JSON.parse(dec);

  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    storageState,
    userAgent: storageState.userAgent,
  });

  const page = await ctx.newPage();
  page.on('response', res => {
    if (res.url().includes('linkedin.com')) {
      console.log('HTTP', res.status(), res.url().slice(0, 80));
    }
  });

  try {
    const res = await page.goto("https://www.linkedin.com/feed/", { timeout: 20000 });
    console.log("Main response status:", res ? res.status() : "null");
  } catch (err) {
    console.log("Navigation error:", err.message);
  }
  console.log("Final page URL:", page.url());
  await page.waitForTimeout(3000);
  await browser.close();
}

testStatus().catch(console.error);
