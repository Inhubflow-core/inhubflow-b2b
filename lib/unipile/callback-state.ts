import crypto from "node:crypto";

interface CallbackState {
  accountId: string;
  expiresAt: number;
}

export function createHostedAuthState(accountId: string, secret: string, expiresAt = Date.now() + 60 * 60 * 1000): string {
  const payload = Buffer.from(JSON.stringify({ accountId, expiresAt } satisfies CallbackState), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyHostedAuthState(token: string, secret: string, now = Date.now()): CallbackState | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const suppliedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CallbackState;
    if (!parsed.accountId || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt < now) return null;
    return parsed;
  } catch {
    return null;
  }
}
