import type Database from "better-sqlite3";

export interface AuthorizedAccount {
  id: string;
  name: string;
  unipile_account_id: string | null;
  unipile_status: string | null;
}

/**
 * Obtiene todas las cuentas autorizadas para el usuario en sesión.
 * Si es superadmin o admin: todas las cuentas.
 * Si es un miembro de equipo asignado a una cuenta: solo esa cuenta.
 * Si es el owner del workspace: todas sus cuentas.
 */
export function getAuthorizedAccounts(
  db: Database.Database,
  sessionUser: any
): AuthorizedAccount[] {
  if (!sessionUser) return [];

  const email = typeof sessionUser.email === "string" ? sessionUser.email.trim().toLowerCase() : "";
  const isSuperAdmin = email === "inhubflow@gmail.com";

  if (isSuperAdmin) {
    return db
      .prepare("SELECT id, name, unipile_account_id, unipile_status FROM accounts ORDER BY name ASC")
      .all() as AuthorizedAccount[];
  }

  const ownerId = typeof sessionUser.owner_id === "string" && sessionUser.owner_id ? sessionUser.owner_id : null;
  const workspaceOwnerId = ownerId ?? sessionUser.id;
  const isWorkspaceOwner = ownerId === null;
  const role = typeof sessionUser.role === "string" ? sessionUser.role : "user";
  const isWorkspaceAdmin = isWorkspaceOwner || role === "admin";
  const assignedAccountId =
    typeof sessionUser.assigned_account_id === "string" && sessionUser.assigned_account_id
      ? sessionUser.assigned_account_id
      : null;

  if (isWorkspaceAdmin) {
    if (isWorkspaceOwner) {
      return db
        .prepare(
          "SELECT id, name, unipile_account_id, unipile_status FROM accounts WHERE owner_id = ? OR owner_id IS NULL ORDER BY name ASC"
        )
        .all(workspaceOwnerId) as AuthorizedAccount[];
    }
    return db
      .prepare(
        "SELECT id, name, unipile_account_id, unipile_status FROM accounts WHERE owner_id = ? ORDER BY name ASC"
      )
      .all(workspaceOwnerId) as AuthorizedAccount[];
  }

  // Miembro estándar de equipo asignado a una cuenta
  if (assignedAccountId) {
    return db
      .prepare(
        "SELECT id, name, unipile_account_id, unipile_status FROM accounts WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)"
      )
      .all(assignedAccountId, workspaceOwnerId) as AuthorizedAccount[];
  }

  return db
    .prepare(
      "SELECT id, name, unipile_account_id, unipile_status FROM accounts WHERE assigned_user_id = ? AND (owner_id = ? OR owner_id IS NULL) ORDER BY name ASC"
    )
    .all(sessionUser.id, workspaceOwnerId) as AuthorizedAccount[];
}

/**
 * Retorna los IDs de las cuentas autorizadas.
 */
export function getAuthorizedAccountIds(
  db: Database.Database,
  sessionUser: any
): string[] {
  return getAuthorizedAccounts(db, sessionUser).map((a) => a.id);
}

/**
 * Valida si un account_id específico está dentro de los permitidos para el usuario.
 */
export function isAccountAuthorized(
  db: Database.Database,
  sessionUser: any,
  accountId: string
): boolean {
  if (!accountId) return false;
  const allowed = getAuthorizedAccountIds(db, sessionUser);
  return allowed.includes(accountId);
}

/**
 * Obtiene un post de social_selling_posts asegurando que pertenezca a una cuenta autorizada del usuario.
 */
export function getAuthorizedPost(
  db: Database.Database,
  sessionUser: any,
  postId: string
): any | null {
  if (!postId) return null;
  const allowed = getAuthorizedAccountIds(db, sessionUser);
  if (allowed.length === 0) return null;

  const placeholders = allowed.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM social_selling_posts WHERE id = ? AND account_id IN (${placeholders})`)
    .get(postId, ...allowed);
}
