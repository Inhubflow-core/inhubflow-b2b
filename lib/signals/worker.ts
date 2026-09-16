import { signalRadarService } from "./service";

let timer: NodeJS.Timeout | null = null;
let ticking = false;

export async function runSignalRadarTick(): Promise<{ processed: number; failed: number }> {
  if (ticking) return { processed: 0, failed: 0 };
  ticking = true;
  let processed = 0;
  let failed = 0;
  try {
    const ids = signalRadarService.getDueMonitorIds(3);
    for (const id of ids) {
      try {
        await signalRadarService.scanMonitor(id, "scheduled");
        processed++;
      } catch (error) {
        failed++;
        console.warn(`[SignalRadar] Escaneo programado ${id} falló:`, error instanceof Error ? error.message : error);
      }
    }
    return { processed, failed };
  } finally {
    ticking = false;
  }
}

export function ensureSignalRadarWorkerStarted(): void {
  if (timer) return;
  const configured = Number(process.env.SIGNAL_RADAR_POLL_MS || 60_000);
  const interval = Math.max(15_000, Math.min(Number.isFinite(configured) ? configured : 60_000, 15 * 60_000));
  console.log(`[signal-radar] Iniciando worker de señales (poll ${interval}ms)...`);
  timer = setInterval(() => {
    runSignalRadarTick().catch((error) => console.error("[signal-radar] Error en tick:", error));
  }, interval);
  setTimeout(() => {
    runSignalRadarTick().catch((error) => console.error("[signal-radar] Error en tick inicial:", error));
  }, 5_000);
}
