import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "node:http";
import crypto, { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import bcrypt from "bcryptjs";

async function readRawBody(req: IncomingMessage & { body?: unknown }): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function verifyPaddleSignature(rawBody: string, signatureHeader: string, secretKey: string): boolean {
  try {
    const parts = signatureHeader.split(";").reduce<Record<string, string>>((acc, part) => {
      const [key, value] = part.split("=");
      if (key && value) acc[key.trim()] = value.trim();
      return acc;
    }, {});

    const ts = parts["ts"];
    const h1 = parts["h1"];
    if (!ts || !h1) return false;

    // Tolerance window: 5 minutes (300 seconds)
    const timestamp = parseInt(ts, 10);
    const now = Math.floor(Date.now() / 1000);
    if (isNaN(timestamp) || Math.abs(now - timestamp) > 300) {
      console.warn("[Paddle Webhook] ⚠️ Timestamp fuera de tolerancia.");
      return false;
    }

    const payload = `${ts}:${rawBody}`;
    const hmac = crypto.createHmac("sha256", secretKey).update(payload).digest("hex");
    const hmacBuf = Buffer.from(hmac, "utf8");
    const h1Buf = Buffer.from(h1, "utf8");

    return hmacBuf.length === h1Buf.length && crypto.timingSafeEqual(hmacBuf, h1Buf);
  } catch {
    return false;
  }
}

/**
 * Webhook handler for Paddle Billing.
 * Automatically provisions and manages subscriber slots and statuses.
 * Cryptographically verifies Paddle-Signature before taking any action.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const paddleSecret = (process.env.PADDLE_WEBHOOK_SECRET_KEY || process.env.PADDLE_WEBHOOK_SECRET)?.trim();
  if (!paddleSecret) {
    console.error("[Paddle Webhook] ❌ PADDLE_WEBHOOK_SECRET_KEY no configurado en variables de entorno.");
    return res.status(503).json({ error: "Paddle webhook secret no configurado en el servidor." });
  }

  let rawBodyBuffer: Buffer;
  try {
    rawBodyBuffer = await readRawBody(req as unknown as IncomingMessage & { body?: unknown });
  } catch (readErr) {
    return res.status(400).json({ error: "Error leyendo payload del webhook" });
  }

  const rawBodyString = rawBodyBuffer.toString("utf8");
  const signatureHeader = req.headers["paddle-signature"];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

  if (!signature || !verifyPaddleSignature(rawBodyString, signature, paddleSecret)) {
    console.warn("[Paddle Webhook] 🛑 Intento rechazado: Firma Paddle-Signature inválida o ausente.");
    return res.status(401).json({ error: "Firma Paddle-Signature inválida o ausente." });
  }

  try {
    const body = JSON.parse(rawBodyString);

    const eventType = body?.event_type || body?.alert_name || "unknown";
    const data = body?.data || body;

    console.log(`[Paddle Webhook] 🔔 Received event: ${eventType}`);

    const db = getDb();

    // Extract customer email & details
    const customerEmail = (
      data?.customer?.email ||
      data?.custom_data?.email ||
      data?.email ||
      data?.passthrough?.email ||
      ""
    ).trim().toLowerCase();

    const customerId = data?.customer_id || data?.customer?.id || null;
    const subscriptionId = data?.subscription_id || data?.id || null;
    const status = (data?.status || "active").toLowerCase();

    // Determine plan tier and slots from items/prices or custom data
    let planTier: "starter" | "growth" | "business" | "custom" = "starter";
    let slots = 1;

    // Exact mapping for InHubFlow Paddle Price IDs
    const OFFICIAL_PRICE_MAP: Record<string, { planTier: "starter" | "growth" | "business"; slots: number }> = {
      "pri_01m1h9gkcyvsdsknad7nyz7pv1": { planTier: "starter", slots: 1 },
      "pri_01m1h9my3vbqcsp9t2hgqqkkxv": { planTier: "growth", slots: 5 },
      "pri_01m1h9sy759c7p0kg76309we3h": { planTier: "business", slots: 10 },
    };

    // Check items for exact price ID match first
    const items = data?.items || [];
    let matchedByPriceId = false;

    for (const item of items) {
      const priceId = item?.price?.id || item?.price_id || "";
      if (OFFICIAL_PRICE_MAP[priceId]) {
        planTier = OFFICIAL_PRICE_MAP[priceId].planTier;
        slots = OFFICIAL_PRICE_MAP[priceId].slots;
        matchedByPriceId = true;
        break;
      }
    }

    if (!matchedByPriceId) {
      // Check custom_data
      if (data?.custom_data?.slots) {
        slots = parseInt(data.custom_data.slots, 10) || 1;
      } else if (data?.custom_data?.plan) {
        const p = String(data.custom_data.plan).toLowerCase();
        if (p.includes("business") || p.includes("scale") || p.includes("10")) { planTier = "business"; slots = 10; }
        else if (p.includes("growth") || p.includes("5")) { planTier = "growth"; slots = 5; }
        else { planTier = "starter"; slots = 1; }
      } else {
        // Fallback: Check items array descriptions
        for (const item of items) {
          const desc = (
            (item?.price?.description || "") +
            " " +
            (item?.price?.name || "") +
            " " +
            (item?.product?.name || "")
          ).toLowerCase();

          if (desc.includes("10") || desc.includes("business") || desc.includes("scale")) {
            planTier = "business";
            slots = 10;
            break;
          } else if (desc.includes("5") || desc.includes("growth")) {
            planTier = "growth";
            slots = 5;
            break;
          } else if (desc.includes("1") || desc.includes("starter")) {
            planTier = "starter";
            slots = 1;
          }
        }
      }

      if (slots === 10) planTier = "business";
      else if (slots === 5) planTier = "growth";
      else if (slots === 1) planTier = "starter";
      else planTier = "custom";
    }

    // Find existing user by subscriptionId, customerId, or email
    let user = null;
    if (subscriptionId) {
      user = db.prepare("SELECT id, email FROM users WHERE paddle_subscription_id = ?").get(subscriptionId) as { id: string; email: string } | undefined;
    }
    if (!user && customerEmail) {
      user = db.prepare("SELECT id, email FROM users WHERE email = ?").get(customerEmail) as { id: string; email: string } | undefined;
    }
    if (!user && customerId) {
      user = db.prepare("SELECT id, email FROM users WHERE paddle_customer_id = ?").get(customerId) as { id: string; email: string } | undefined;
    }

    let targetUserId = user?.id;

    // If user does not exist and it's a new subscription, create account automatically
    if (!user && customerEmail) {
      targetUserId = randomUUID();
      const randomPassword = "InHubFlow-" + randomUUID().slice(0, 8);
      const hash = bcrypt.hashSync(randomPassword, 10);

      db.prepare(`
        INSERT INTO users (
          id, email, password_hash, role, slots_limit, subscription_status, plan_tier,
          paddle_customer_id, paddle_subscription_id
        ) VALUES (?, ?, ?, 'user', ?, 'active', ?, ?, ?)
      `).run(
        targetUserId,
        customerEmail,
        hash,
        slots,
        planTier,
        customerId,
        subscriptionId
      );

      console.log(`[Paddle Webhook] 👤 New user automatically created: ${customerEmail} (Slots: ${slots})`);

      // Send automated welcome email with credentials
      try {
        const { sendWelcomeEmail } = await import("@/lib/email/welcome-email");
        await sendWelcomeEmail({
          to: customerEmail,
          companyName: undefined,
          password: randomPassword,
          planTier: planTier,
          slotsLimit: slots,
        });
      } catch (mailErr) {
        console.error("[Paddle Webhook] Failed to send welcome email:", mailErr);
      }
    } else if (targetUserId) {
      // Update existing user according to event type
      if (
        eventType.includes("subscription.created") ||
        eventType.includes("subscription.activated") ||
        eventType.includes("subscription_created")
      ) {
        db.prepare(`
          UPDATE users 
          SET subscription_status = 'active',
              slots_limit = ?,
              plan_tier = ?,
              paddle_customer_id = COALESCE(?, paddle_customer_id),
              paddle_subscription_id = COALESCE(?, paddle_subscription_id),
              updated_at = datetime('now')
          WHERE id = ?
        `).run(slots, planTier, customerId, subscriptionId, targetUserId);

        console.log(`[Paddle Webhook] ✅ Activated subscription for user ${targetUserId} with ${slots} slots.`);
      } else if (
        eventType.includes("subscription.updated") ||
        eventType.includes("subscription_updated")
      ) {
        const subStatus = status === "past_due" ? "past_due" : status === "canceled" ? "canceled" : "active";
        db.prepare(`
          UPDATE users 
          SET slots_limit = ?,
              plan_tier = ?,
              subscription_status = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(slots, planTier, subStatus, targetUserId);

        console.log(`[Paddle Webhook] 🔄 Updated subscription for user ${targetUserId} to ${slots} slots (${subStatus}).`);
      } else if (
        eventType.includes("subscription.canceled") ||
        eventType.includes("subscription_cancelled")
      ) {
        db.prepare(`
          UPDATE users 
          SET subscription_status = 'canceled',
              updated_at = datetime('now')
          WHERE id = ?
        `).run(targetUserId);

        console.log(`[Paddle Webhook] 🛑 Canceled subscription for user ${targetUserId}.`);
      }
    }

    // Always log event in subscription_logs
    db.prepare(`
      INSERT INTO subscription_logs (
        id, user_id, customer_email, event_type, plan_tier, slots, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      targetUserId || null,
      customerEmail || null,
      eventType,
      planTier,
      slots,
      JSON.stringify(body)
    );

    return res.status(200).json({ received: true, event: eventType });
  } catch (err: unknown) {
    console.error("[Paddle Webhook] ❌ Error processing webhook:", err);
    return res.status(500).json({ error: "Error interno procesando webhook" });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};

