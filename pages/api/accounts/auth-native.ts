import type { NextApiRequest, NextApiResponse } from "next";
import { unipile } from "@/lib/unipile/client";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { UnipileProxyConfig } from "@/lib/unipile/types";

function parseProxyString(raw?: string): UnipileProxyConfig | undefined {
  if (!raw || !raw.trim()) return undefined;
  const trimmed = raw.trim();

  try {
    // Si viene como URL completa (ej. http://user:pass@host:port o socks5://host:port)
    if (/^https?:\/\//i.test(trimmed) || /^socks5:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const proto = url.protocol.replace(":", "").toLowerCase() as "http" | "https" | "socks5";
      return {
        host: url.hostname,
        port: Number(url.port) || (proto === "https" ? 443 : 80),
        protocol: proto === "https" ? "https" : proto === "socks5" ? "socks5" : "http",
        ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
        ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      };
    }

    // Si viene en formato con @ (ej. user:pass@host:port)
    if (trimmed.includes("@")) {
      const [auth, hostPort] = trimmed.split("@");
      const [u, p] = auth.split(":");
      const [h, port] = hostPort.split(":");
      if (h && port) {
        return {
          host: h.trim(),
          port: Number(port.trim()) || 80,
          protocol: "http",
          ...(u ? { username: u.trim() } : {}),
          ...(p ? { password: p.trim() } : {}),
        };
      }
    }

    // Si viene en formato de 4 partes (ej. host:port:user:pass)
    const parts = trimmed.split(":");
    if (parts.length === 4) {
      return {
        host: parts[0].trim(),
        port: Number(parts[1].trim()) || 80,
        protocol: "http",
        username: parts[2].trim(),
        password: parts[3].trim(),
      };
    }

    // Si viene en formato simple de 2 partes (ej. host:port)
    if (parts.length === 2) {
      return {
        host: parts[0].trim(),
        port: Number(parts[1].trim()) || 80,
        protocol: "http",
      };
    }
  } catch (err) {
    console.warn("[parseProxyString] Error interpretando proxy:", err);
  }

  return undefined;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido. Usa POST." });
  }

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  if (!unipile.isConfigured()) {
    return res.status(503).json({
      error: "El servicio de conexión no está configurado en el servidor.",
    });
  }

  const {
    accountId,
    mode = "credentials",
    username,
    password,
    accessToken,
    premiumToken,
    country,
    proxy: rawProxy,
    userAgent,
  } = req.body as {
    accountId?: string;
    mode?: "credentials" | "cookie";
    username?: string;
    password?: string;
    accessToken?: string;
    premiumToken?: string;
    country?: string;
    proxy?: string;
    userAgent?: string;
  };

  if (!accountId) {
    return res.status(400).json({ error: "El ID de la cuenta es obligatorio." });
  }

  if (mode === "cookie") {
    if (!accessToken?.trim()) {
      return res.status(400).json({
        error: "Por favor proporciona el valor de la cookie li_at de LinkedIn.",
      });
    }
  } else {
    if (!username?.trim() || !password) {
      return res.status(400).json({
        error: "Por favor proporciona tu correo/teléfono y contraseña de LinkedIn.",
      });
    }
  }

  try {
    const db = getDb();
    const localAccount = db
      .prepare("SELECT id, name, email, unipile_account_id FROM accounts WHERE id = ?")
      .get(accountId) as { id: string; name: string; email: string; unipile_account_id?: string | null } | undefined;

    if (!localAccount || !canAccessLinkedInAccount(db, actor, accountId)) {
      return res.status(404).json({ error: "Cuenta no encontrada o sin permisos de acceso" });
    }

    const proxyConfig = parseProxyString(rawProxy);
    const clientUserAgent = userAgent?.trim() || (req.headers["user-agent"] as string) || undefined;

    // Llamada unificada a Unipile con soporte de credenciales o cookies, país y proxy
    const authRes = await unipile.startCredentialsAuth({
      name: accountId,
      ...(mode === "cookie"
        ? {
            accessToken: accessToken?.trim(),
            ...(premiumToken?.trim() ? { premiumToken: premiumToken.trim() } : {}),
            userAgent: clientUserAgent,
          }
        : {
            username: username?.trim(),
            password,
          }),
      ...(country?.trim() ? { country: country.trim().toUpperCase() } : {}),
      ...(proxyConfig ? { proxy: proxyConfig } : {}),
    });

    // Caso 1: Checkpoint / 2FA requerido por LinkedIn (Status 202)
    if (authRes.object === "Checkpoint" || authRes.checkpoint) {
      const remoteAccountId = authRes.account_id || authRes.id;
      if (remoteAccountId) {
        db.prepare(
          "UPDATE accounts SET unipile_account_id = ?, unipile_status = 'CHECKPOINT' WHERE id = ?"
        ).run(remoteAccountId, accountId);
      }

      return res.status(200).json({
        success: true,
        checkpoint: true,
        checkpointType: authRes.checkpoint?.type || "2FA",
        remoteAccountId,
        accountId,
      });
    }

    // Caso 2: Login exitoso directo
    const remoteId = authRes.id || authRes.account_id;
    if (remoteId) {
      db.prepare(`
        UPDATE accounts 
        SET unipile_account_id = ?, unipile_status = 'OK', is_authenticated = 1 
        WHERE id = ?
      `).run(remoteId, accountId);
    }

    return res.status(200).json({
      success: true,
      checkpoint: false,
      status: "OK",
      accountId,
      remoteAccountId: remoteId,
    });
  } catch (error: unknown) {
    console.error("[pages/api/accounts/auth-native] Error en conexión con LinkedIn:", error);

    const errStatus = (error as { status?: number })?.status;
    const errBody = (error as { body?: string })?.body || "";
    const lowerBody = errBody.toLowerCase();

    // Detección de error de proxy (502 / proxy_error)
    if (errStatus === 502 || lowerBody.includes("proxy_error") || lowerBody.includes("proxy in use")) {
      return res.status(400).json({
        error: "El proxy configurado no responde o no es accesible. Por favor verifica los datos del proxy o déjalo en blanco.",
      });
    }

    // Detección de credenciales o cookies inválidas (401)
    const isInvalidCreds =
      errStatus === 401 ||
      lowerBody.includes("invalid_credentials") ||
      lowerBody.includes("credentials are invalid") ||
      lowerBody.includes("cookie");

    if (isInvalidCreds) {
      return res.status(400).json({
        error:
          mode === "cookie"
            ? "La cookie li_at de LinkedIn es inválida o ha caducado. Por favor copia una cookie activa desde tu navegador."
            : "Credenciales de LinkedIn incorrectas. Por favor verifica tu correo y contraseña.",
      });
    }

    return res.status(400).json({
      error: "No se pudo conectar con LinkedIn. Por favor revisa los datos ingresados o inténtalo más tarde.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
