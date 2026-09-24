export async function register() {
  // Only run on the Node.js server runtime, not in the browser/edge
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const [
        { ensureGlobalRunnerStarted },
        { ensureSdrWorkerStarted },
        { ensureSignalRadarWorkerStarted },
        { ensureSocialSellingWorkerStarted },
      ] = await Promise.all([
        import("@/lib/linkedin/runner"),
        import("@/lib/sdr-agent/worker"),
        import("@/lib/signals/worker"),
        import("@/lib/social-selling/worker"),
      ]);
      ensureGlobalRunnerStarted();
      ensureSdrWorkerStarted();
      ensureSignalRadarWorkerStarted();
      ensureSocialSellingWorkerStarted();
    } catch (err) {
      console.error("[instrumentation] Failed to start runner:", err);
    }
  }
}
