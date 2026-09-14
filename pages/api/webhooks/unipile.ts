import type { NextApiRequest, NextApiResponse } from "next";
import { handleUnipileWebhook } from "@/lib/unipile/webhooks";
import type { UnipileWebhookPayload } from "@/lib/unipile/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const payload = req.body as UnipileWebhookPayload;

    if (!payload || !payload.event) {
      return res.status(400).json({ error: "Payload inválido. Falta propiedad 'event'." });
    }

    const result = await handleUnipileWebhook(payload);

    return res.status(200).json({
      received: true,
      result,
    });
  } catch (error) {
    console.error("[pages/api/webhooks/unipile] Error procesando webhook:", error);
    return res.status(500).json({
      error: "Error interno procesando webhook de Unipile",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
