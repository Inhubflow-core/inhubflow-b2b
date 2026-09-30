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

/**
 * Webhook handler for Lemon Squeezy Billing & InHubFlow Partner Attribution.
 * Automatically provisions subscriber slots and attributes recurring 25% commissions to InHubFlow Partners.
 * Cryptographically verifies Lemon Squeezy HMAC-SHA256 signature before taking any action.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[LemonSqueezy Webhook] ❌ LEMONSQUEEZY_WEBHOOK_SECRET no está configurado en las variables de entorno.");
    return res.status(503).json({ error: "Webhook secret no configurado en el servidor." });
  }

  let rawBodyBuffer: Buffer;
  try {
    rawBodyBuffer = await readRawBody(req as unknown as IncomingMessage & { body?: unknown });
  } catch (readErr) {
    return res.status(400).json({ error: "Error leyendo payload del webhook" });
  }

  const signatureHeader = req.headers["x-signature"];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

  if (!signature) {
    console.warn("[LemonSqueezy Webhook] 🛑 Intento rechazado: Falta cabecera x-signature obligatoria.");
    return res.status(401).json({ error: "Falta la firma criptográfica x-signature" });
  }

  const hmac = crypto.createHmac("sha256", secret).update(rawBodyBuffer).digest("hex");
  const hmacBuf = Buffer.from(hmac, "utf8");
  const sigBuf = Buffer.from(signature, "utf8");

  if (hmacBuf.length !== sigBuf.length || !crypto.timingSafeEqual(hmacBuf, sigBuf)) {
    console.warn("[LemonSqueezy Webhook] 🛑 Intento rechazado: Firma x-signature inválida.");
    return res.status(401).json({ error: "Firma criptográfica inválida" });
  }

  try {
    const rawBodyString = rawBodyBuffer.toString("utf8");
    const body = JSON.parse(rawBodyString);

    const eventName = body?.meta?.event_name || req.headers["x-event-name"] || "unknown";
    const customData = body?.meta?.custom_data || {};
    const data = body?.data || {};
    const attributes = data?.attributes || {};

    console.log(`[LemonSqueezy Webhook] 🔔 Received event: ${eventName}`);

    const db = getDb();

    // Extract customer details
    const customerEmail = (
      customData.admin_email ||
      attributes.user_email ||
      data?.customer?.email ||
      ""
    ).trim().toLowerCase();

    const companyName = customData.company_name || attributes.user_name || "Mi Empresa B2B";
    const customerId = String(attributes.customer_id || data?.customer_id || "");
    const subscriptionId = String(data.id || attributes.order_id || "");
    const totalAmount = (attributes.total || attributes.subtotal || 0) / 100; // in dollars (Lemon Squeezy uses cents)

    // Determine slots limit from plan_id or product_name
    const planId = (customData.plan_id || attributes.product_name || "").toLowerCase();
    const slots = planId.includes("10") || planId.includes("business")
      ? 10
      : planId.includes("5") || planId.includes("growth")
      ? 5
      : 1;

    const planTier = slots === 10 ? "business" : slots === 5 ? "growth" : "starter";

    // Detect InHubFlow Partner Code (from ?25-OFF=SE7GH)
    const partnerCode = (
      customData.partner_code ||
      customData.ambassador_code ||
      customData.code ||
      ""
    ).trim().toUpperCase();

    let matchedPartner: any = null;
    if (partnerCode) {
      matchedPartner = db.prepare("SELECT * FROM partners WHERE code = ?").get(partnerCode);
      if (matchedPartner) {
        console.log(`[InHubFlow Partner Webhook] 🤝 Matched Partner: '${matchedPartner.name}' (Code: ${matchedPartner.code})`);
      }
    }

    switch (eventName) {
      case "subscription_created":
      case "order_created": {
        if (!customerEmail) {
          console.warn("[LemonSqueezy Webhook] ⚠️ No customer email found in webhook event.");
          return res.status(200).json({ received: true, warning: "Missing email" });
        }

        let user = db.prepare("SELECT id, email, partner_id FROM users WHERE email = ?").get(customerEmail) as any;
        const targetPartnerId = matchedPartner ? matchedPartner.id : (user?.partner_id || null);

        if (!user) {
          // Provision new tenant user
          const newUserId = randomUUID();
          const tempPassword = customData.admin_password || `InHubFlow${Math.floor(1000 + Math.random() * 9000)}!`;
          const passwordHash = bcrypt.hashSync(tempPassword, 10);

          db.prepare(`
            INSERT INTO users (
              id, email, password_hash, role, company_name, slots_limit, 
              subscription_status, plan_tier, lemon_customer_id, lemon_subscription_id, 
              partner_id, created_at, updated_at
            ) VALUES (?, ?, ?, 'user', ?, ?, 'active', ?, ?, ?, ?, datetime('now'), datetime('now'))
          `).run(
            newUserId,
            customerEmail,
            passwordHash,
            companyName,
            slots,
            planTier,
            customerId || null,
            subscriptionId || null,
            targetPartnerId
          );

          console.log(`[LemonSqueezy Webhook] 👤 User created: ${customerEmail} (Plan: ${planTier}, Slots: ${slots})`);

          // Send automated welcome email with credentials
          try {
            const { sendWelcomeEmail } = await import("@/lib/email/welcome-email");
            await sendWelcomeEmail({
              to: customerEmail,
              companyName: companyName,
              password: tempPassword,
              planTier: planTier,
              slotsLimit: slots,
            });
          } catch (mailErr) {
            console.error("[LemonSqueezy Webhook] Failed to send welcome email:", mailErr);
          }

          user = { id: newUserId, email: customerEmail, partner_id: targetPartnerId };
        } else {
          // Update existing user with plan and partner
          db.prepare(`
            UPDATE users SET 
              slots_limit = ?, 
              subscription_status = 'active', 
              plan_tier = ?, 
              company_name = COALESCE(?, company_name),
              lemon_customer_id = COALESCE(?, lemon_customer_id),
              lemon_subscription_id = COALESCE(?, lemon_subscription_id),
              partner_id = COALESCE(?, partner_id),
              updated_at = datetime('now')
            WHERE id = ?
          `).run(slots, planTier, companyName, customerId || null, subscriptionId || null, targetPartnerId, user.id);

          console.log(`[LemonSqueezy Webhook] 🔄 Updated subscription for user ${user.id} (${planTier}, ${slots} slots).`);
        }

        // Commission attribution to InHubFlow Partner
        if (targetPartnerId) {
          const partner = db.prepare("SELECT * FROM partners WHERE id = ?").get(targetPartnerId) as any;
          if (partner) {
            const billAmount = totalAmount > 0 ? totalAmount : (slots === 10 ? 192 : slots === 5 ? 128 : 32);
            const commissionPct = partner.commission_pct || 50.0;
            const commissionAmount = parseFloat(((billAmount * commissionPct) / 100).toFixed(2));

            // Record referral
            db.prepare(`
              INSERT INTO partner_referrals (
                id, partner_id, customer_email, company_name, plan_id, subscription_id, 
                amount, commission_amount, status, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
            `).run(
              randomUUID(),
              partner.id,
              customerEmail,
              companyName,
              planTier,
              subscriptionId || null,
              billAmount,
              commissionAmount
            );

            // Increment partner balance
            db.prepare(`
              UPDATE partners 
              SET balance = balance + ?, updated_at = datetime('now') 
              WHERE id = ?
            `).run(commissionAmount, partner.id);

            console.log(`[InHubFlow Partner] 💰 Credited $${commissionAmount} USD (50%) to partner ${partner.name} (${partner.code})`);
          }
        }

        return res.status(200).json({ received: true, action: "provisioned", slots, partner: partnerCode || null });
      }

      case "subscription_payment_success":
      case "subscription_updated": {
        // Recurring subscription renewal
        let user = db.prepare("SELECT id, email, partner_id, slots_limit FROM users WHERE lemon_subscription_id = ? OR email = ?").get(subscriptionId, customerEmail) as any;

        if (user && user.partner_id) {
          const partner = db.prepare("SELECT * FROM partners WHERE id = ?").get(user.partner_id) as any;
          if (partner) {
            const billAmount = totalAmount > 0 ? totalAmount : (user.slots_limit === 10 ? 192 : user.slots_limit === 5 ? 128 : 32);
            const commissionPct = partner.commission_pct || 50.0;
            const commissionAmount = parseFloat(((billAmount * commissionPct) / 100).toFixed(2));

            db.prepare(`
              INSERT INTO partner_referrals (
                id, partner_id, customer_email, company_name, plan_id, subscription_id, 
                amount, commission_amount, status, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
            `).run(
              randomUUID(),
              partner.id,
              user.email,
              companyName,
              user.plan_tier || "starter",
              subscriptionId,
              billAmount,
              commissionAmount
            );

            db.prepare(`
              UPDATE partners 
              SET balance = balance + ?, updated_at = datetime('now') 
              WHERE id = ?
            `).run(commissionAmount, partner.id);

            console.log(`[InHubFlow Partner] 🔄 Recurring renewal credited: $${commissionAmount} USD to partner ${partner.name}`);
          }
        }

        return res.status(200).json({ received: true, action: "renewal_logged" });
      }

      case "subscription_cancelled":
      case "subscription_expired": {
        db.prepare(`
          UPDATE users SET subscription_status = 'canceled', updated_at = datetime('now') 
          WHERE lemon_subscription_id = ? OR email = ?
        `).run(subscriptionId, customerEmail);

        db.prepare(`
          UPDATE partner_referrals SET status = 'canceled' WHERE subscription_id = ?
        `).run(subscriptionId);

        console.log(`[LemonSqueezy Webhook] 🛑 Subscription canceled: ${subscriptionId} (${customerEmail})`);
        return res.status(200).json({ received: true, action: "canceled" });
      }

      default:
        return res.status(200).json({ received: true, unhandled: eventName });
    }
  } catch (err: any) {
    console.error("[LemonSqueezy Webhook] ❌ Error:", err);
    return res.status(500).json({ error: "Error procesando webhook: " + err.message });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};

