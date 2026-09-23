import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import { getNextBatchPublishingSlots } from "@/lib/social-selling/slots";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const { account_id } = req.body;
  if (!account_id) {
    return res.status(400).json({ error: "account_id es requerido" });
  }

  const db = getDb();

  try {
    // 1. Obtener publicaciones ya publicadas para no colisionar con ellas
    const published = db.prepare(
      "SELECT scheduled_at FROM social_selling_posts WHERE account_id = ? AND status = 'published'"
    ).all(account_id) as Array<{ scheduled_at: string }>;

    // 2. Obtener todas las publicaciones pendientes de publicación
    const scheduledPosts = db.prepare(
      "SELECT id, scheduled_at FROM social_selling_posts WHERE account_id = ? AND status = 'scheduled' ORDER BY scheduled_at ASC, created_at ASC"
    ).all(account_id) as Array<{ id: string; scheduled_at: string }>;

    if (scheduledPosts.length === 0) {
      return res.status(200).json({ success: true, updated_count: 0, message: "No hay publicaciones pendientes para reorganizar" });
    }

    // 3. Generar slots limpios en Lunes, Miércoles y Viernes
    const slots = getNextBatchPublishingSlots(scheduledPosts.length, published, 10, 0);

    const updateStmt = db.prepare(
      "UPDATE social_selling_posts SET scheduled_at = ? WHERE id = ?"
    );

    db.transaction(() => {
      for (let i = 0; i < scheduledPosts.length; i++) {
        const slotIso = slots[i].toISOString();
        updateStmt.run(slotIso, scheduledPosts[i].id);
      }
    })();

    return res.status(200).json({
      success: true,
      updated_count: scheduledPosts.length,
      message: `Se reorganizaron ${scheduledPosts.length} publicaciones en Lunes, Miércoles y Viernes`,
    });
  } catch (error) {
    console.error("[api/social-selling/reorganize] Error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Error al reorganizar el calendario",
    });
  }
}
