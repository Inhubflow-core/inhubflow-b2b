import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDemoDb } from "@/lib/db";
import { seedDemoWorkspace } from "@/lib/demo/seed-demo";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const authHeader = req.headers["authorization"] || "";
  const token = req.query.token as string;
  const authPassword = process.env.AUTH_PASSWORD;

  const isAuthorized =
    session?.user?.email === "inhubflow@gmail.com" ||
    (session?.user as { role?: string })?.role === "admin" ||
    (Boolean(authPassword) && token === authPassword) ||
    (Boolean(process.env.INTERNAL_API_SECRET) && authHeader === `Bearer ${process.env.INTERNAL_API_SECRET}`);

  if (!isAuthorized) {
    return res.status(403).json({ error: "Acceso denegado. Se requieren permisos de SuperAdmin." });
  }

  try {
    const db = getDemoDb();
    const result = seedDemoWorkspace(db);
    return res.status(200).json({
      success: true,
      message: "Cuenta demo sembrada exitosamente con datos comerciales 'engordados' y 100% funcionales.",
      credentials: {
        email: result.email,
        password: result.password,
        role: "admin",
        plan: "Business (10 Slots)",
      },
    });
  } catch (err: unknown) {
    console.error("[api/admin/seed-demo] Error:", err);
    return res.status(500).json({ error: (err as Error)?.message || "Error al sembrar cuenta demo." });
  }
}
