import type { SourceAdapter, SourceContext, SourceResult } from "./types";
import { openMeteoAdapter } from "./openMeteo";
import { airQualityAdapter } from "./airQuality";
import { wildfireAdapter } from "./wildfire";
import { usgsWaterAdapter } from "./usgsWater";
import { withCache } from "../cache";
import { gridKey } from "../geo";
import type { SourceStatus } from "../types";

/**
 * The adapter registry. Adding a source — SNOTEL telemetry, avalanche
 * forecasts, road closures — means writing one file and adding it here;
 * nothing downstream changes.
 */
export const ADAPTERS: SourceAdapter[] = [
  openMeteoAdapter,
  airQualityAdapter,
  wildfireAdapter,
  usgsWaterAdapter,
];

export interface GatherResult {
  /** Merged values across every adapter that succeeded. */
  values: SourceResult["values"];
  refs: SourceResult["refs"];
  extras: Record<string, unknown>;
  status: SourceStatus[];
}

const EMPTY: SourceResult = { values: {}, refs: {}, extras: {} };

/**
 * Fetch every source for one grid cell, in parallel, with per-source failure
 * isolation.
 *
 * A source that throws is reported as degraded and contributes nothing; the
 * scoring layer then reports the factors it could not compute instead of
 * inventing them. One dead upstream never blanks the page.
 */
export async function gather(context: SourceContext): Promise<GatherResult> {
  const cell = gridKey(context.point);
  const dateKey = context.dates.slice().sort().join(",");

  const settled = await Promise.all(
    ADAPTERS.map(async (adapter): Promise<{ result: SourceResult; status: SourceStatus }> => {
      const startedAt = Date.now();
      try {
        const cached = await withCache(
          `${adapter.id}|${cell}|${dateKey}`,
          { ttlSeconds: adapter.ttlSeconds, staleSeconds: adapter.staleSeconds },
          () => adapter.fetch(context),
        );

        return {
          result: cached.value,
          status: {
            sourceId: adapter.id,
            sourceName: adapter.name,
            ok: true,
            latencyMs: Date.now() - startedAt,
            cached: cached.cached,
            cacheAgeSeconds: cached.cached ? Math.round(cached.ageSeconds) : undefined,
          },
        };
      } catch (error) {
        return {
          result: EMPTY,
          status: {
            sourceId: adapter.id,
            sourceName: adapter.name,
            ok: false,
            latencyMs: Date.now() - startedAt,
            cached: false,
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }),
  );

  const values: SourceResult["values"] = {};
  const refs: SourceResult["refs"] = {};
  const extras: Record<string, unknown> = {};

  for (const entry of settled) {
    Object.assign(values, entry.result.values);
    Object.assign(refs, entry.result.refs);
    Object.assign(extras, entry.result.extras ?? {});
  }

  return { values, refs, extras, status: settled.map((e) => e.status) };
}

/** Merge status lists from several grid cells into one per-source summary. */
export function mergeStatus(lists: SourceStatus[][]): SourceStatus[] {
  const merged = new Map<string, SourceStatus>();

  for (const list of lists) {
    for (const status of list) {
      const existing = merged.get(status.sourceId);
      if (!existing) {
        merged.set(status.sourceId, { ...status });
        continue;
      }
      merged.set(status.sourceId, {
        ...existing,
        // A source is only healthy if it was healthy everywhere.
        ok: existing.ok && status.ok,
        latencyMs: Math.max(existing.latencyMs, status.latencyMs),
        cached: existing.cached && status.cached,
        error: existing.error ?? status.error,
        cacheAgeSeconds:
          existing.cacheAgeSeconds !== undefined && status.cacheAgeSeconds !== undefined
            ? Math.max(existing.cacheAgeSeconds, status.cacheAgeSeconds)
            : (existing.cacheAgeSeconds ?? status.cacheAgeSeconds),
      });
    }
  }

  return [...merged.values()];
}
