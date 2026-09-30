import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { getDb, getDemoDb } from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    return res.status(401).json({ error: "No autenticado." });
  }

  const currentUser = session.user as any;
  const isDemo = currentUser.email?.trim().toLowerCase() === "demo@inhubflow.com";
  const db = isDemo ? getDemoDb() : getDb();

  if (currentUser.owner_id) {
    return res.status(403).json({ error: "Solo el Administrador del equipo puede modificar miembros." });
  }

  const ownerId = currentUser.id;
  const targetId = req.query.id as string;

  if (!targetId) {
    return res.status(400).json({ error: "ID de miembro o invitación requerido." });
  }

  // DELETE: Revoke/delete a team member or pending invitation
  if (req.method === "DELETE") {
    try {
      // 1. Check if target is a team member
      const member = db.prepare("SELECT id, email, assigned_account_id FROM users WHERE id = ? AND owner_id = ?").get(targetId, ownerId) as any;
      if (member) {
        // If they had an account assigned, clear assigned_user_id in accounts
        if (member.assigned_account_id) {
          db.prepare("UPDATE accounts SET assigned_user_id = NULL WHERE id = ?").run(member.assigned_account_id);
        }

        db.prepare("DELETE FROM users WHERE id = ?").run(targetId);
        return res.status(200).json({ success: true, message: `El acceso de ${member.email} ha sido revocado y el slot liberado.` });
      }

      // 2. Check if target is an invitation
      const invite = db.prepare("SELECT id, email FROM team_invitations WHERE id = ? AND owner_id = ?").get(targetId, ownerId) as any;
      if (invite) {
        db.prepare("DELETE FROM team_invitations WHERE id = ?").run(targetId);
        return res.status(200).json({ success: true, message: `La invitación para ${invite.email} ha sido cancelada.` });
      }

      return res.status(404).json({ error: "Miembro o invitación no encontrada." });
    } catch (err: any) {
      console.error("[Team API DELETE error]:", err);
      return res.status(500).json({ error: "Error al revocar: " + err.message });
    }
  }

  // PATCH: Reassign LinkedIn account to a team member
  if (req.method === "PATCH") {
    try {
      const { assigned_account_id, role } = req.body;

      const member = db.prepare("SELECT id, email FROM users WHERE id = ? AND owner_id = ?").get(targetId, ownerId) as any;
      if (!member) {
        return res.status(404).json({ error: "Miembro de equipo no encontrado." });
      }

      if (assigned_account_id !== undefined) {
        db.prepare("UPDATE users SET assigned_account_id = ? WHERE id = ?").run(assigned_account_id || null, targetId);

        if (assigned_account_id) {
          db.prepare("UPDATE accounts SET assigned_user_id = ? WHERE id = ?").run(targetId, assigned_account_id);
        }
      }

      if (role && (role === "admin" || role === "member")) {
        db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, targetId);
      }

      const updated = db.prepare("SELECT id, name, email, role, assigned_account_id FROM users WHERE id = ?").get(targetId);
      return res.status(200).json({ success: true, member: updated });
    } catch (err: any) {
      console.error("[Team API PATCH error]:", err);
      return res.status(500).json({ error: "Error al actualizar miembro: " + err.message });
    }
  }

  return res.status(405).json({ error: "Método no permitido." });
}
