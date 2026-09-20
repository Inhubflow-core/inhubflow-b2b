import { useEffect, useState } from "react";
import { DEFAULT_TIMEZONE, normalizeTimeZone } from "@/lib/calendar/time";

/**
 * Workspace timezone for client components that render calendar times.
 *
 * Every timestamp in the app is stored as UTC ISO, so a view that prints a time
 * without knowing the workspace zone will drift (and can even land on the wrong
 * day). The public settings endpoint exposes the zone; until it answers we fall
 * back to the default zone rather than the browser's, which would be silently
 * wrong for a shared workspace.
 */
export function useWorkspaceTimezone(): string {
  const [timezone, setTimezone] = useState<string>(DEFAULT_TIMEZONE);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/calendar/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const raw = data?.settings?.timezone ?? data?.timezone;
        const zone = normalizeTimeZone(typeof raw === "string" ? raw : "");
        if (zone) setTimezone(zone);
      })
      .catch(() => {
        /* keep the default zone */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return timezone;
}
