import { NextResponse } from "next/server";
import { climbsFor, hasClimbData } from "@/lib/sources/openbetaLive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/climbs?id=maple-canyon -- walls and routes for one climbing area. */
export async function GET(request: Request): Promise<NextResponse> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!hasClimbData(id)) return NextResponse.json({ error: "No route data for this place." }, { status: 404 });

  try {
    const data = await climbsFor(id);
    return NextResponse.json(data, {
      headers: { "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch {
    return NextResponse.json(
      { error: "OpenBeta is unavailable right now." },
      { status: 503, headers: { "cache-control": "public, s-maxage=120" } },
    );
  }
}
