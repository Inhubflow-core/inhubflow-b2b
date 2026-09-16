export async function register() {
  // Only run on the Node.js server runtime, not in the browser/edge
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const [{ ensureGlobalRunnerStarted }, { ensureSdrWorkerStarted }, { ensureSignalRadarWorkerStarted }] = await Promise.all([
        import("@/lib/linkedin/runner"),
        import("@/lib/sdr-agent/worker"),
        import("@/lib/signals/worker"),
      ]);
      ensureGlobalRunnerStarted();
      ensureSdrWorkerStarted();
      ensureSignalRadarWorkerStarted();
    } catch (err) {
      console.error("[instrumentation] Failed to start runner:", err);
    }
  }
}
