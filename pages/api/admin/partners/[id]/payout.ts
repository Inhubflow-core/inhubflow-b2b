import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

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

  const { id } = req.query;
  const partnerId = String(id);

  try {
    const partner = db.prepare("SELECT * FROM partners WHERE id = ?").get(partnerId) as any;
    if (!partner) {
      return res.status(404).json({ error: "Partner no encontrado." });
    }

    const { amount, reference, notes } = req.body;
    const payoutAmount = typeof amount === "number" ? amount : parseFloat(amount);

    if (isNaN(payoutAmount) || payoutAmount <= 0) {
      return res.status(400).json({ error: "El monto a liquidar debe ser mayor a 0." });
    }

    const payoutId = randomUUID();

    // 1. Record payout
    db.prepare(`
      INSERT INTO partner_payouts (id, partner_id, amount, reference, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(payoutId, partnerId, payoutAmount, reference || null, notes || null);

    // 2. Deduct from balance and add to total_paid
    const newBalance = Math.max(0, (partner.balance || 0) - payoutAmount);
    const newTotalPaid = (partner.total_paid || 0) + payoutAmount;

    db.prepare(`
      UPDATE partners 
      SET balance = ?, total_paid = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newBalance, newTotalPaid, partnerId);

    const updated = db.prepare("SELECT * FROM partners WHERE id = ?").get(partnerId);

    return res.status(200).json({
      success: true,
      message: `Liquidación de $${payoutAmount.toFixed(2)} USD registrada con éxito.`,
      partner: updated,
    });
  } catch (err: any) {
    console.error("[Partner Payout API] Error:", err);
    return res.status(500).json({ error: "Error al registrar pago: " + err.message });
  }
}
