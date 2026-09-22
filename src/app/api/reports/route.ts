import { NextResponse } from "next/server";
import { clientAddress, readSummary, submitReport } from "@/lib/reports/service";
import { reportStore } from "@/lib/reports/store";
import { getTrail } from "@/lib/trails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/reports?trailId=lake-blanche */
export async function GET(request: Request): Promise<NextResponse> {
  const trailId = new URL(request.url).searchParams.get("trailId") ?? "";
  if (!getTrail(trailId)) {
    return NextResponse.json({ error: "Unknown place." }, { status: 400 });
  }

  try {
    const summary = await readSummary(trailId);
    return NextResponse.json(
      { storage: reportStore().kind, summary },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Reports are unavailable right now." }, { status: 503 });
  }
}

/** POST /api/reports  { "trailId": "...", "kind": "muddy", "note": "optional" } */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { trailId?: unknown; kind?: unknown; note?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  try {
    const result = await submitReport({
      trailId: body.trailId,
      kind: body.kind,
      note: body.note,
      address: clientAddress(request.headers),
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      { storage: reportStore().kind, summary: result.summary, confirmedNow: result.confirmedNow },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Could not save the report." }, { status: 503 });
  }
}
