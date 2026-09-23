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

  const isSuperAdmin =
    sessionUser?.role === "admin" ||
    sessionUser?.email?.trim().toLowerCase() === "inhubflow@gmail.com";

  if (isSuperAdmin) {
    return db
      .prepare("SELECT id, name, unipile_account_id, unipile_status FROM accounts ORDER BY name ASC")
      .all() as AuthorizedAccount[];
  }

  if (sessionUser?.owner_id && sessionUser?.assigned_account_id) {
    return db
      .prepare("SELECT id, name, unipile_account_id, unipile_status FROM accounts WHERE id = ?")
      .all(sessionUser.assigned_account_id) as AuthorizedAccount[];
  }

  if (sessionUser?.owner_id) {
    return db
      .prepare("SELECT id, name, unipile_account_id, unipile_status FROM accounts WHERE assigned_user_id = ?")
      .all(sessionUser.id) as AuthorizedAccount[];
  }

  // Owner del workspace o cuenta individual
  return db
    .prepare("SELECT id, name, unipile_account_id, unipile_status FROM accounts WHERE owner_id = ? OR owner_id IS NULL ORDER BY name ASC")
    .all(sessionUser.id) as AuthorizedAccount[];
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
