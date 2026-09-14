import type { NextApiRequest, NextApiResponse } from "next";
import { unipile } from "@/lib/unipile/client";
import { requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  if (!unipile.isConfigured()) {
    return res.status(503).json({
      error: "Unipile no está configurado en el servidor. Por favor define UNIPILE_DSN y UNIPILE_API_KEY.",
    });
  }

  try {
    const { name, successUrl, failureUrl } = req.body as {
      name?: string;
      successUrl?: string;
      failureUrl?: string;
    };

    const host = req.headers.host || "localhost:3000";
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const baseUrl = `${protocol}://${host}`;

    const linkResponse = await unipile.getHostedAuthLink({
      type: "create",
      providers: ["LINKEDIN"],
      name: name || `InHubFlow - ${actor.email}`,
      success_redirect_url: successUrl || `${baseUrl}/settings?unipile_status=success`,
      failure_redirect_url: failureUrl || `${baseUrl}/settings?unipile_status=error`,
      notify_url: `${baseUrl}/api/webhooks/unipile`,
    });

    return res.status(200).json({
      url: linkResponse.url,
    });
  } catch (error) {
    console.error("[pages/api/accounts/unipile-link] Error generando link de Unipile:", error);
    return res.status(500).json({
      error: "No se pudo generar el enlace de conexión de Unipile",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
