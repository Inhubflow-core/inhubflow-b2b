import crypto from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "node:http";
import { handleUnipileWebhook, verifyUnipileSignature } from "@/lib/unipile/webhooks";
import type { UnipileWebhookPayload } from "@/lib/unipile/types";

async function readRawBody(req: IncomingMessage & { body?: unknown }): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function configuredSecrets(): string[] {
  return [
    process.env.UNIPILE_WEBHOOK_SECRET,
    ...(process.env.UNIPILE_WEBHOOK_SECRETS || "").split(","),
  ].map((secret) => secret?.trim() || "").filter(Boolean);
}

function verifyStaticToken(supplied: string | undefined, expected: string): boolean {
  if (!supplied || !expected) return false;
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });
  const secrets = configuredSecrets();
  const expectedToken = process.env.UNIPILE_WEBHOOK_TOKEN?.trim() || "";
  if (secrets.length === 0 && !expectedToken) {
    return res.status(503).json({ error: "No hay autenticación de webhooks configurada" });
  }

  try {
    const rawBody = await readRawBody(req as unknown as IncomingMessage & { body?: unknown });
    const signatureHeader = req.headers["unipile-signature"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const tokenHeader = req.headers["x-inhubflow-webhook-token"];
    const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    const validHmac = Boolean(signature) && secrets.some((secret) => verifyUnipileSignature(rawBody, signature!, secret));
    const validToken = verifyStaticToken(token, expectedToken);
    if (!validHmac && !validToken) {
      return res.status(401).json({ error: "Autenticación de webhook inválida" });
    }

    const payload = JSON.parse(rawBody.toString("utf8")) as UnipileWebhookPayload;
    if (!payload.event && !payload.AccountStatus) return res.status(400).json({ error: "Payload inválido: falta event" });

    const result = await handleUnipileWebhook(payload);
    return res.status(result.handled ? 200 : 202).json({ received: true, result });
  } catch (error) {
    console.error("[linkedin-webhook] Error procesando webhook:", error);
    return res.status(400).json({ error: "Payload de webhook inválido" });
  }
}

export const config = { api: { bodyParser: false } };
