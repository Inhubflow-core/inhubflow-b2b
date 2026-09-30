import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

function generatePartnerCode(length = 5): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed ambiguous characters I, 1, O, 0
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);

  if (!session?.user) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const db = getDb();
  const userEmail = session.user.email?.trim().toLowerCase();
  let userRole = (session.user as { role?: string })?.role || "user";

  if (userEmail === "inhubflow@gmail.com") {
    userRole = "admin";
  }

  if (userRole !== "admin") {
    return res.status(403).json({ error: "Acceso denegado. Se requieren privilegios de SuperAdmin." });
  }

  // GET: List all partners & summary metrics
  if (req.method === "GET") {
    try {
      const partners = db.prepare(`
        SELECT 
          p.id,
          p.code,
          p.name,
          p.email,
          p.phone,
          p.payout_method,
          p.payout_account,
          p.commission_pct,
          p.balance,
          p.total_paid,
          p.status,
          p.notes,
          p.created_at,
          p.updated_at,
          COUNT(r.id) as total_referrals,
          SUM(CASE WHEN r.status = 'active' THEN 1 ELSE 0 END) as active_referrals,
          COALESCE(SUM(r.amount), 0) as total_revenue_generated,
          COALESCE(SUM(r.commission_amount), 0) as total_commission_accumulated
        FROM partners p
        LEFT JOIN partner_referrals r ON p.id = r.partner_id
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `).all() as any[];

      const summary = {
        total_partners: partners.length,
        active_partners: partners.filter(p => p.status === 'active').length,
        total_referrals: partners.reduce((sum, p) => sum + Number(p.total_referrals || 0), 0),
        total_balance_due: partners.reduce((sum, p) => sum + Number(p.balance || 0), 0),
        total_paid_out: partners.reduce((sum, p) => sum + Number(p.total_paid || 0), 0),
      };

      const formattedPartners = partners.map(p => ({
        ...p,
        discount_link: `https://inhubflow.online?20-OFF=${p.code}`,
      }));

      return res.status(200).json({ partners: formattedPartners, summary });
    } catch (err: any) {
      console.error("[Partners API] Error fetching partners:", err);
      return res.status(500).json({ error: "Error al obtener partners: " + err.message });
    }
  }

  // POST: Create a new Partner
  if (req.method === "POST") {
    try {
      const { name, email, phone, payout_method, payout_account, commission_pct, custom_code, notes } = req.body;

      if (!name || !email) {
        return res.status(400).json({ error: "El nombre y el email del partner son requeridos." });
      }

      let code = (custom_code ? String(custom_code).trim().toUpperCase() : "").replace(/[^A-Z0-9]/g, "");

      if (!code) {
        // Generate unique 5-character code
        let attempts = 0;
        while (attempts < 10) {
          const candidate = generatePartnerCode(5);
          const existing = db.prepare("SELECT id FROM partners WHERE code = ?").get(candidate);
          if (!existing) {
            code = candidate;
            break;
          }
          attempts++;
        }
      }

      // Check for code collisions
      const collision = db.prepare("SELECT id FROM partners WHERE code = ?").get(code);
      if (collision) {
        return res.status(400).json({ error: `El código '${code}' ya está en uso por otro Partner.` });
      }

      const partnerId = randomUUID();
      const pct = typeof commission_pct === 'number' ? commission_pct : 50.0;

      db.prepare(`
        INSERT INTO partners (
          id, code, name, email, phone, payout_method, payout_account, commission_pct, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(
        partnerId,
        code,
        name.trim(),
        email.trim().toLowerCase(),
        phone ? String(phone).trim() : null,
        payout_method || 'PayPal',
        payout_account ? String(payout_account).trim() : null,
        pct,
        notes ? String(notes).trim() : null
      );

      const created = db.prepare("SELECT * FROM partners WHERE id = ?").get(partnerId) as any;

      return res.status(201).json({
        success: true,
        partner: {
          ...created,
          discount_link: `https://inhubflow.online?20-OFF=${created.code}`,
        },
      });
    } catch (err: any) {
      console.error("[Partners API] Error creating partner:", err);
      return res.status(500).json({ error: "Error al crear partner: " + err.message });
    }
  }

  return res.status(405).json({ error: "Método no permitido" });
}
