import { NextResponse } from "next/server";
import { getTrail } from "@/lib/trails";
import { hasLines, linesFor } from "@/lib/sources/osmLines";
import { hasClimbData, wallsFor } from "@/lib/sources/openbetaLive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/geo?id=lake-blanche
 *
 * What to draw for one place: trail or river lines from OpenStreetMap, or
 * climbing walls from OpenBeta. One place per request, so each is cached at
 * the edge on its own and one slow upstream never holds up the rest.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!getTrail(id)) return NextResponse.json({ error: "Unknown place." }, { status: 400 });

  try {
    const [lines, walls] = await Promise.all([
      hasLines(id) ? linesFor(id) : Promise.resolve([]),
      hasClimbData(id) ? wallsFor(id) : Promise.resolve([]),
    ]);
    return NextResponse.json(
      { lines, walls: walls.map((w) => [w.lng, w.lat, w.n, w.c]) },
      { headers: { "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch {
    // Short edge cache so a rate-limited upstream is retried soon, not hammered.
    return NextResponse.json(
      { lines: [], walls: [], unavailable: true },
      { status: 200, headers: { "cache-control": "public, s-maxage=300" } },
    );
  }
}
