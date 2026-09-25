import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import {
  saveProfilesToList,
  SearchProgressEvent,
  SearchLead,
} from "@/lib/linkedin/search";
import { searchLinkedInWithXRay, XRaySearchError } from "@/lib/linkedin/xray";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    accountId,
    title,
    location,
    country,
    city,
    company,
    keywords,
    limit = 25,
    listName,
    stream = true,
    strictTitle = true,
  } = req.body || {};

  const effectiveLocation = location || [city?.trim(), country?.trim()].filter(Boolean).join(", ");

  if (!title && !effectiveLocation && !company && !keywords) {
    return res.status(400).json({
      error: "Debes ingresar al menos un criterio de búsqueda (Cargo, Ubicación, Empresa o Palabras Clave).",
    });
  }

  const numericLimit = Math.min(Math.max(parseInt(String(limit), 10) || 25, 5), 100);
  const parts = [title?.trim(), effectiveLocation?.trim(), company?.trim()].filter(Boolean);
  const cleanListName =
    listName?.trim() ||
    `${parts.length > 0 ? parts.join(" - ") : "Prospectos"} (${new Date().toLocaleDateString("es-ES", {
      month: "short",
      year: "numeric",
    })})`.trim();

  // If streaming is requested (via body or Accept header)
  if (stream || req.headers.accept?.includes("text/event-stream")) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const sendEvent = (event: string, data: unknown) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        // @ts-expect-error Next.js flush if available
        if (typeof res.flush === "function") res.flush();
      } catch {
        /* client disconnected */
      }
    };

    sendEvent("init", {
      message: "Conectado al motor Google X-Ray Search para LinkedIn...",
      filters: { title, location, company, keywords },
      limit: numericLimit,
      listName: cleanListName,
    });

    try {
      const db = getDb();
      let profiles: SearchLead[] = [];

      // ─── TIER 1: High-Precision Google X-Ray Search ─────────────────────────
      try {
        profiles = await searchLinkedInWithXRay(
          {
            title,
            location: effectiveLocation,
            country,
            city,
            company,
            keywords,
            limit: numericLimit,
            strictTitle: strictTitle !== false,
          },
          (progress: SearchProgressEvent) => {
            sendEvent("progress", progress);
            if (progress.currentLead) {
              sendEvent("lead", progress.currentLead);
            }
          }
        );
      } catch (xrayErr: unknown) {
        console.error("[search-and-import] Google X-Ray error:", xrayErr);
        const message = xrayErr instanceof Error ? xrayErr.message : "Error durante la búsqueda con Google X-Ray.";
        const code = xrayErr instanceof XRaySearchError ? xrayErr.code : "provider_error";
        sendEvent("error", { error: message, code });
        res.end();
        return;
      }

      // Note: We deliberately DO NOT fallback to internal LinkedIn search session
      // to 100% protect the user's LinkedIn profile from search rate limits and "Commercial Use Limit" warnings.

      sendEvent("saving", {
        message: `Guardando ${profiles.length} prospectos en la lista "${cleanListName}"...`,
        totalFound: profiles.length,
      });

      let saveResult = { listId: "", listName: cleanListName, importedCount: 0, updatedCount: 0 };
      if (profiles.length > 0) {
        saveResult = saveProfilesToList(db, {
          listName: cleanListName,
          description: `Búsqueda X-Ray: ${[title, location, company].filter(Boolean).join(" | ")}`,
          profiles,
        });
      }

      sendEvent("complete", {
        success: true,
        listId: saveResult.listId,
        listName: saveResult.listName,
        importedCount: saveResult.importedCount,
        updatedCount: saveResult.updatedCount,
        totalFound: profiles.length,
        profiles,
        message:
          profiles.length > 0
            ? `¡Lista "${cleanListName}" creada exitosamente con ${profiles.length} prospectos!`
            : "No se encontraron perfiles con estos criterios específicos. Prueba simplificando la búsqueda.",
      });

      res.end();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error durante la búsqueda y extracción de prospectos";
      sendEvent("error", { error: message });
      res.end();
    }
    return;
  }

  // Non-streaming JSON response
  try {
    const db = getDb();
    let profiles: SearchLead[] = [];

    try {
      profiles = await searchLinkedInWithXRay({
        title,
        location: effectiveLocation,
        country,
        city,
        company,
        keywords,
        limit: numericLimit,
        strictTitle: strictTitle !== false,
      });
    } catch (xrayErr: unknown) {
      console.error("[search-and-import] Google X-Ray non-streaming error:", xrayErr);
      const message = xrayErr instanceof Error ? xrayErr.message : "Error durante la búsqueda de prospectos.";
      const code = xrayErr instanceof XRaySearchError ? xrayErr.code : "provider_error";
      return res.status(500).json({ error: message, code });
    }

    let saveResult = { listId: "", listName: cleanListName, importedCount: 0, updatedCount: 0 };
    if (profiles.length > 0) {
      saveResult = saveProfilesToList(db, {
        listName: cleanListName,
        description: `Búsqueda X-Ray: ${[title, location, company].filter(Boolean).join(" | ")}`,
        profiles,
      });
    }

    return res.status(200).json({
      success: true,
      listId: saveResult.listId,
      listName: saveResult.listName,
      importedCount: saveResult.importedCount,
      updatedCount: saveResult.updatedCount,
      totalFound: profiles.length,
      profiles,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error durante la búsqueda de prospectos";
    return res.status(500).json({ error: message });
  }
}
