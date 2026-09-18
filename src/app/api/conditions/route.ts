import { NextResponse } from "next/server";
import { buildReports } from "@/lib/report";
import { parseActivity } from "@/lib/activities";
import { forecastWindow, isWithinForecastWindow, todayIso } from "@/lib/dates";
import type { ConditionsResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/conditions?date=YYYY-MM-DD&activity=hike
 *
 * Returns a scored report for every trail that supports the activity.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const today = todayIso();

  const requestedDate = url.searchParams.get("date");
  const date =
    requestedDate && isWithinForecastWindow(requestedDate, today) ? requestedDate : today;

  const activity = parseActivity(url.searchParams.get("activity"));

  try {
    const built = await buildReports({
      date,
      activity,
      // Warm the whole forecast window in the same upstream call so that
      // switching days in the UI is served from cache.
      alsoFetch: forecastWindow(today),
      signal: request.signal,
    });

    const body: ConditionsResponse = {
      generatedAt: new Date().toISOString(),
      date,
      activity,
      reports: built.reports,
      sourceStatus: built.sourceStatus,
      degraded: built.degraded,
      scored: built.scored,
      available: built.available,
    };

    return NextResponse.json(body, {
      headers: {
        // Cache at the edge briefly, and keep serving the old copy while a
        // new one is built. Conditions data does not need to be to-the-second.
        "cache-control": "public, s-maxage=300, stale-while-revalidate=1800",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
