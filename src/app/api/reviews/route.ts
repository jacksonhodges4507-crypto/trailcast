import { NextResponse } from "next/server";
import { clientAddress } from "@/lib/reports/service";
import { reportStore } from "@/lib/reports/store";
import { readReviews, submitReview } from "@/lib/reviews/service";
import { getTrail } from "@/lib/trails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/reviews?trailId=lake-blanche */
export async function GET(request: Request): Promise<NextResponse> {
  const trailId = new URL(request.url).searchParams.get("trailId") ?? "";
  if (!getTrail(trailId)) {
    return NextResponse.json({ error: "Unknown place." }, { status: 400 });
  }

  try {
    const summary = await readReviews(trailId);
    return NextResponse.json(
      { storage: reportStore().kind, summary },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Reviews are unavailable right now." }, { status: 503 });
  }
}

/** POST /api/reviews  { "trailId": "...", "verdict": "worth-it", "note": "optional" } */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { trailId?: unknown; verdict?: unknown; note?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  try {
    const result = await submitReview({
      trailId: body.trailId,
      verdict: body.verdict,
      note: body.note,
      address: clientAddress(request.headers),
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      { storage: reportStore().kind, summary: result.summary },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Could not save the review." }, { status: 503 });
  }
}
