import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

// Encrypts secrets at rest (LinkedIn session cookies, email passwords, API keys) so a
// leaked/copied database doesn't hand those out in plaintext. Key is derived from
// NEXTAUTH_SECRET (already a required, real secret) via HKDF — no new env var needed.
//
// Format: "v1:<iv-base64>:<authTag-base64>:<ciphertext-base64>". decryptSecret() passes
// any value NOT in this format straight through unchanged, so pre-migration plaintext
// rows keep working — see lib/db.ts's encryptLegacySecretsMigration.

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function deriveKey(info: string = "inhubflow-secret-encryption"): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET must be set to encrypt/decrypt stored secrets");
  return Buffer.from(hkdfSync("sha256", secret, "", info, 32));
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(value: string | null): string | null {
  if (value === null) return null;
  if (!isEncrypted(value)) return value; // not-yet-migrated plaintext — pass through

  const [, ivB64, authTagB64, dataB64] = value.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");

  try {
    const key = deriveKey("inhubflow-secret-encryption");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    return null;
  }
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}:`);
}
