import { getDb } from "@/lib/db";
import { publishDueScheduledPosts } from "./publisher";

let timer: NodeJS.Timeout | null = null;
let ticking = false;

export async function runSocialSellingWorkerTick(): Promise<{ processed: number; failed: number }> {
  if (ticking) return { processed: 0, failed: 0 };
  ticking = true;
  let processed = 0;
  let failed = 0;

  try {
    const db = getDb();
    const results = await publishDueScheduledPosts(db, 5);

    for (const r of results) {
      if (r.status === "published") {
        processed++;
        console.log(
          `[social-selling-worker] Post ${r.id} publicado automáticamente en LinkedIn con éxito (URN: ${r.post_urn})`
        );
      } else if (r.status === "failed") {
        failed++;
        console.warn(
          `[social-selling-worker] Publicación automática de post ${r.id} falló:`,
          r.error
        );
      }
    }

    return { processed, failed };
  } catch (error) {
    console.error("[social-selling-worker] Error en tick:", error);
    return { processed, failed };
  } finally {
    ticking = false;
  }
}

/**
 * Inicia el despachador autónomo en segundo plano para Social Selling.
 * Revisa periódicamente cada 30 segundos si hay publicaciones cuya hora programada
 * ha llegado para publicarlas de forma 100% desatendida.
 */
export function ensureSocialSellingWorkerStarted(): void {
  if (timer) return;
  const configured = Number(process.env.SOCIAL_SELLING_POLL_MS || 30_000);
  const interval = Math.max(
    15_000,
    Math.min(Number.isFinite(configured) ? configured : 30_000, 5 * 60_000)
  );

  console.log(`[social-selling-worker] Iniciando despachador autónomo (poll ${interval}ms)...`);

  timer = setInterval(() => {
    runSocialSellingWorkerTick().catch((error) =>
      console.error("[social-selling-worker] Error en tick:", error)
    );
  }, interval);

  // Tick inicial a los 3 segundos del arranque del servidor
  setTimeout(() => {
    runSocialSellingWorkerTick().catch((error) =>
      console.error("[social-selling-worker] Error en tick inicial:", error)
    );
  }, 3_000);
}
