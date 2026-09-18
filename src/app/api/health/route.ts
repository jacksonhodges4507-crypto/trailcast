import { NextResponse } from "next/server";
import { ADAPTERS } from "@/lib/sources";
import { isLlmEnabled } from "@/lib/ask/llm";
import { TRAILS } from "@/lib/trails";
import { todayIso } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A deployment's self-description: which sources are wired up, whether the
 * optional model layer is configured, and how big the dataset is. Useful when
 * something looks wrong in production and you need to know what is even on.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      ok: true,
      today: todayIso(),
      trails: TRAILS.length,
      llmEnabled: isLlmEnabled(),
      sources: ADAPTERS.map((adapter) => ({
        id: adapter.id,
        name: adapter.name,
        homepage: adapter.homepage,
        ttlSeconds: adapter.ttlSeconds,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
