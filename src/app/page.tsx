import Dashboard from "./components/Dashboard";
import { buildReports } from "@/lib/report";
import { forecastWindow, todayIso } from "@/lib/dates";
import type { ConditionsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Server component: the first paint already contains real scored data, so
 * the page is useful before any client JavaScript runs. Subsequent activity
 * and day changes are handled client-side against /api/conditions, which by
 * then is serving the same upstream response out of cache.
 */
export default async function Page() {
  const today = todayIso();

  let initial: ConditionsResponse;

  try {
    const built = await buildReports({
      date: today,
      activity: "hike",
      alsoFetch: forecastWindow(today),
    });

    initial = {
      generatedAt: new Date().toISOString(),
      date: today,
      activity: "hike",
      reports: built.reports,
      sourceStatus: built.sourceStatus,
      degraded: built.degraded,
    };
  } catch {
    // Never let an upstream outage produce a blank page: hand the client an
    // empty, explicitly degraded payload and let it retry.
    initial = {
      generatedAt: new Date().toISOString(),
      date: today,
      activity: "hike",
      reports: [],
      sourceStatus: [],
      degraded: true,
    };
  }

  return <Dashboard initial={initial} today={today} />;
}
