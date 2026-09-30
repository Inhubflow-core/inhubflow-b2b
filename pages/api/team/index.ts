import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { getDb, getDemoDb } from "@/lib/db";
import { randomUUID } from "crypto";

function generateInviteCode(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "INV-";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    return res.status(401).json({ error: "No autenticado." });
  }

  const currentUser = session.user as any;
  const isDemo = currentUser.email?.trim().toLowerCase() === "demo@inhubflow.com";
  const db = isDemo ? getDemoDb() : getDb();

  // Only Workspace Owners / Admins can manage the team
  if (currentUser.owner_id) {
    return res.status(403).json({ error: "Solo el Administrador del equipo puede gestionar miembros." });
  }

  const ownerId = currentUser.id;

  // GET: Fetch team members, accounts, and pending invitations
  if (req.method === "GET") {
    try {
      const ownerRow = db
        .prepare("SELECT id, name, email, role, slots_limit, company_name, plan_tier FROM users WHERE id = ?")
        .get(ownerId) as any;

      if (!ownerRow) {
        return res.status(404).json({ error: "Workspace no encontrado." });
      }

      // Fetch all team members under this owner
      const members = db
        .prepare(`
          SELECT u.id, u.name, u.email, u.role, u.assigned_account_id, u.created_at,
                 a.name as account_name, a.email as account_email, a.is_authenticated as account_authenticated
          FROM users u
          LEFT JOIN accounts a ON u.assigned_account_id = a.id
          WHERE u.owner_id = ?
          ORDER BY u.created_at ASC
        `)
        .all(ownerId) as any[];

      // Fetch all pending invitations
      const invitations = db
        .prepare(`
          SELECT i.id, i.email, i.role, i.invite_code, i.status, i.expires_at, i.created_at,
                 a.name as account_name
          FROM team_invitations i
          LEFT JOIN accounts a ON i.assigned_account_id = a.id
          WHERE i.owner_id = ? AND i.status = 'pending'
          ORDER BY i.created_at DESC
        `)
        .all(ownerId) as any[];

      // Fetch workspace accounts available
      const accounts = db
        .prepare("SELECT id, name, email, is_authenticated FROM accounts ORDER BY created_at DESC")
        .all() as any[];

      const totalSlots = ownerRow.slots_limit || 1;
      const assignedSlots = members.length + 1; // Owner + members
      const pendingInvites = invitations.length;
      const availableSlots = Math.max(0, totalSlots - (members.length + 1) - pendingInvites);

      const proto = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers["x-forwarded-host"] || req.headers.host || "b2b.inhubflow.online";
      const baseUrl = `${proto}://${host}`;

      const formattedInvitations = invitations.map((inv) => ({
        ...inv,
        invite_url: `${baseUrl}/invite?code=${inv.invite_code}`,
      }));

      return res.status(200).json({
        owner: ownerRow,
        members,
        invitations: formattedInvitations,
        accounts,
        capacity: {
          totalSlots,
          usedSlots: assignedSlots + pendingInvites,
          availableSlots,
        },
      });
    } catch (err: any) {
      console.error("[Team API GET error]:", err);
      return res.status(500).json({ error: "Error al cargar el equipo: " + err.message });
    }
  }

  // POST: Create a new Team Invitation
  if (req.method === "POST") {
    try {
      const { email, assigned_account_id, role = "member" } = req.body;

      if (!email || !email.includes("@")) {
        return res.status(400).json({ error: "Debes ingresar un email válido." });
      }

      const normalizedEmail = email.trim().toLowerCase();

      // Check if user already exists
      const existingUser = db.prepare("SELECT id, owner_id FROM users WHERE email = ?").get(normalizedEmail) as any;
      if (existingUser) {
        if (existingUser.owner_id === ownerId) {
          return res.status(400).json({ error: "Este usuario ya es miembro de tu equipo." });
        }
        return res.status(400).json({ error: "Este correo ya está registrado en otra cuenta." });
      }

      // Check slot limits
      const ownerRow = db.prepare("SELECT slots_limit FROM users WHERE id = ?").get(ownerId) as any;
      const totalSlots = ownerRow?.slots_limit || 1;

      const memberCount = (db.prepare("SELECT COUNT(*) as c FROM users WHERE owner_id = ?").get(ownerId) as any).c;
      const pendingCount = (
        db
          .prepare("SELECT COUNT(*) as c FROM team_invitations WHERE owner_id = ? AND status = 'pending'")
          .get(ownerId) as any
      ).c;

      if (memberCount + pendingCount + 1 >= totalSlots) {
        return res.status(400).json({
          error: `Has alcanzado el límite de ${totalSlots} slots de tu plan. Mejora tu plan para invitar más miembros.`,
        });
      }

      // Check for existing pending invitation for same email
      const existingInvite = db
        .prepare("SELECT id, invite_code FROM team_invitations WHERE owner_id = ? AND email = ? AND status = 'pending'")
        .get(ownerId, normalizedEmail) as any;

      if (existingInvite) {
        const proto = req.headers["x-forwarded-proto"] || "https";
        const host = req.headers["x-forwarded-host"] || req.headers.host || "b2b.inhubflow.online";
        return res.status(200).json({
          success: true,
          message: "Ya existía una invitación pendiente para este correo.",
          invitation: {
            ...existingInvite,
            invite_url: `${proto}://${host}/invite?code=${existingInvite.invite_code}`,
          },
        });
      }

      const inviteId = randomUUID();
      const inviteCode = generateInviteCode(8);
      // Expires in 7 days
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      db.prepare(`
        INSERT INTO team_invitations (
          id, owner_id, email, role, assigned_account_id, invite_code, status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))
      `).run(
        inviteId,
        ownerId,
        normalizedEmail,
        role === "admin" ? "admin" : "member",
        assigned_account_id || null,
        inviteCode,
        expiresAt
      );

      const proto = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers["x-forwarded-host"] || req.headers.host || "b2b.inhubflow.online";
      const inviteUrl = `${proto}://${host}/invite?code=${inviteCode}`;

      return res.status(201).json({
        success: true,
        invitation: {
          id: inviteId,
          email: normalizedEmail,
          role,
          invite_code: inviteCode,
          invite_url: inviteUrl,
          expires_at: expiresAt,
        },
      });
    } catch (err: any) {
      console.error("[Team API POST error]:", err);
      return res.status(500).json({ error: "Error al crear la invitación: " + err.message });
    }
  }

  return res.status(405).json({ error: "Método no permitido." });
}
