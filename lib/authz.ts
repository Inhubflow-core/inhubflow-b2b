import type Database from "better-sqlite3";
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb, getDemoDb } from "@/lib/db";

export interface ApiActor {
  id: string;
  email: string;
  role: string;
  ownerId: string | null;
  workspaceOwnerId: string;
  assignedAccountId: string | null;
  isWorkspaceOwner: boolean;
  isWorkspaceAdmin: boolean;
  isSuperAdmin: boolean;
  isDemo: boolean;
  db: Database.Database;
}

type SessionUser = {
  id?: unknown;
  email?: unknown;
  role?: unknown;
  owner_id?: unknown;
  assigned_account_id?: unknown;
};

export async function requireApiActor(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<ApiActor | null> {
  const session = await getServerSession(req, res, authOptions);
  const user = session?.user as SessionUser | undefined;
  if (!user || typeof user.id !== "string" || typeof user.email !== "string") {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }

  const ownerId = typeof user.owner_id === "string" && user.owner_id ? user.owner_id : null;
  const role = typeof user.role === "string" ? user.role : "user";
  const email = user.email.trim().toLowerCase();
  const isDemo = email === "demo@inhubflow.com";
  const isSuperAdmin = email === "inhubflow@gmail.com";
  const isWorkspaceOwner = ownerId === null;
  const db = isDemo ? getDemoDb() : getDb();

  return {
    id: user.id,
    email,
    role,
    ownerId,
    workspaceOwnerId: ownerId ?? user.id,
    assignedAccountId:
      typeof user.assigned_account_id === "string" && user.assigned_account_id
        ? user.assigned_account_id
        : null,
    isWorkspaceOwner,
    isWorkspaceAdmin: isWorkspaceOwner || role === "admin" || isSuperAdmin,
    isSuperAdmin,
    isDemo,
    db,
  };
}

export function actorCanAccessWorkspace(actor: ApiActor, workspaceOwnerId: string | null): boolean {
  if (actor.isDemo) {
    return workspaceOwnerId === actor.workspaceOwnerId || workspaceOwnerId === "demo_user_workspace_01" || workspaceOwnerId === "workspace_demo_01";
  }
  if (actor.isSuperAdmin) {
    // SuperAdmin only accesses real workspaces, never demo mock data
    return workspaceOwnerId !== "demo_user_workspace_01" && workspaceOwnerId !== "workspace_demo_01";
  }
  return Boolean(workspaceOwnerId && workspaceOwnerId === actor.workspaceOwnerId);
}

export function requireWorkspaceAccess(
  actor: ApiActor,
  workspaceOwnerId: string | null,
): void {
  if (!actorCanAccessWorkspace(actor, workspaceOwnerId)) {
    const error = new Error("Resource not found");
    error.name = "AuthorizationError";
    throw error;
  }
}

export function isAuthorizationError(error: unknown): boolean {
  return error instanceof Error && error.name === "AuthorizationError";
}

export function canAccessLinkedInAccount(
  db: Database.Database,
  actor: ApiActor,
  accountId: string,
): boolean {
  const row = db.prepare(
    "SELECT id, owner_id, assigned_user_id FROM accounts WHERE id = ?",
  ).get(accountId) as
    | { id: string; owner_id: string | null; assigned_user_id: string | null }
    | undefined;
  if (!row) return false;
  if (actor.isSuperAdmin) return true;
  if (row.owner_id === actor.workspaceOwnerId) {
    return actor.isWorkspaceAdmin || row.assigned_user_id === actor.id;
  }
  // Legacy single-workspace rows can be claimed only by the top-level owner/admin.
  return row.owner_id === null && actor.isWorkspaceOwner && actor.isWorkspaceAdmin;
}

export function canAccessEmailAccount(
  db: Database.Database,
  actor: ApiActor,
  emailAccountId: string,
): boolean {
  const row = db.prepare(
    "SELECT id, owner_id FROM email_accounts WHERE id = ?",
  ).get(emailAccountId) as { id: string; owner_id: string | null } | undefined;
  if (!row) return false;
  if (actor.isSuperAdmin) return true;
  if (row.owner_id === actor.workspaceOwnerId) return actor.isWorkspaceAdmin || actor.ownerId !== null;
  return row.owner_id === null && actor.isWorkspaceOwner && actor.isWorkspaceAdmin;
}

export function getThreadWorkspaceOwnerId(
  db: Database.Database,
  threadId: string,
): string | null {
  const row = db.prepare(`
    SELECT
      COALESCE(
        th.workspace_owner_id,
        a.owner_id,
        ea.owner_id,
        ag.workspace_owner_id
      ) AS workspace_owner_id
    FROM sdr_threads th
    LEFT JOIN accounts a ON a.id = th.linkedin_account_id
    LEFT JOIN email_accounts ea ON ea.id = th.email_account_id
    LEFT JOIN sdr_agents ag ON ag.id = th.agent_id
    WHERE th.id = ?
  `).get(threadId) as { workspace_owner_id: string | null } | undefined;
  return row?.workspace_owner_id ?? null;
}

export function canAccessSdrThread(
  db: Database.Database,
  actor: ApiActor,
  threadId: string,
): boolean {
  const row = db.prepare(`
    SELECT th.channel, th.linkedin_account_id, th.email_account_id,
      COALESCE(th.workspace_owner_id, a.owner_id, ea.owner_id, ag.workspace_owner_id) AS workspace_owner_id
    FROM sdr_threads th
    LEFT JOIN accounts a ON a.id = th.linkedin_account_id
    LEFT JOIN email_accounts ea ON ea.id = th.email_account_id
    LEFT JOIN sdr_agents ag ON ag.id = th.agent_id
    WHERE th.id = ?
  `).get(threadId) as
    | {
        channel: "linkedin" | "email";
        linkedin_account_id: string | null;
        email_account_id: string | null;
        workspace_owner_id: string | null;
      }
    | undefined;
  if (!row || !actorCanAccessWorkspace(actor, row.workspace_owner_id)) return false;
  if (actor.isWorkspaceAdmin || actor.isSuperAdmin) return true;
  if (row.channel === "linkedin" && row.linkedin_account_id) {
    return canAccessLinkedInAccount(db, actor, row.linkedin_account_id);
  }
  if (row.channel === "email" && row.email_account_id) {
    return canAccessEmailAccount(db, actor, row.email_account_id);
  }
  return false;
}

export function sdrThreadMatchesTarget(
  db: Database.Database,
  threadId: string,
  targetId: string,
): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sdr_threads WHERE id = ? AND target_id = ?")
      .get(threadId, targetId),
  );
}

export function targetBelongsToLinkedInAccount(
  db: Database.Database,
  targetId: string,
  accountId: string,
): boolean {
  return Boolean(db.prepare(`
    SELECT 1
    FROM targets t
    WHERE t.id = ? AND (
      t.last_replied_account_id = ?
      OR EXISTS (
        SELECT 1 FROM linkedin_inbox_messages m
        WHERE m.target_id = t.id AND m.account_id = ?
      )
      OR EXISTS (
        SELECT 1 FROM run_profiles rp
        JOIN runs r ON r.id = rp.run_id
        WHERE rp.target_id = t.id AND r.account_id = ?
      )
    )
  `).get(targetId, accountId, accountId, accountId));
}

export function targetBelongsToEmailAccount(
  db: Database.Database,
  targetId: string,
  emailAccountId: string,
): boolean {
  return Boolean(db.prepare(`
    SELECT 1
    FROM targets t
    WHERE t.id = ? AND (
      EXISTS (
        SELECT 1 FROM email_replies er
        WHERE er.target_id = t.id AND er.email_account_id = ?
      )
      OR EXISTS (
        SELECT 1 FROM run_profiles rp
        JOIN runs r ON r.id = rp.run_id
        WHERE rp.target_id = t.id
          AND COALESCE(rp.email_account_id, r.email_account_id) = ?
      )
    )
  `).get(targetId, emailAccountId, emailAccountId));
}

export function canManageSdrAgent(
  db: Database.Database,
  actor: ApiActor,
  agentId: string,
): boolean {
  const row = db.prepare(
    "SELECT workspace_owner_id FROM sdr_agents WHERE id = ?",
  ).get(agentId) as { workspace_owner_id: string | null } | undefined;
  return Boolean(
    row &&
      actor.isWorkspaceAdmin &&
      actorCanAccessWorkspace(actor, row.workspace_owner_id ?? actor.workspaceOwnerId),
  );
}
