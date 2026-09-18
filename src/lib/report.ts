import { TRAILS } from "./trails";
import { gather, mergeStatus } from "./sources";
import { assembleConditions } from "./conditions";
import { scoreTrail, compareVerdicts } from "./scoring";
import { gridCentre, gridKey } from "./geo";
import { haversineMi } from "./geo";
import type { ActivityId, SourceStatus, Trail, TrailReport } from "./types";

/**
 * Upper bound on areas scored in one request.
 *
 * Importing a real climbing dataset took the catalogue from 18 hand-written
 * entries to several hundred areas. Each distinct grid cell costs one upstream
 * request per source, so an unbounded page load would have fanned out into
 * hundreds of calls against free community APIs. Bounding the work and being
 * explicit about it in the response beats silently hammering someone else's
 * infrastructure.
 */
export const MAX_SCORED = 40;

/** Cap on simultaneous upstream fetches, so we stay a polite client. */
const CONCURRENCY = 8;

/** Minimal promise pool: runs `tasks` at most `limit` at a time, in order. */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      const task = tasks[index];
      if (!task) return;
      results[index] = await task();
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Choose which areas to score when more match than we are willing to fetch.
 * With an origin, the nearest win; without one, the most substantial do.
 */
export function selectCandidates(
  trails: Trail[],
  limit: number,
  origin?: { lat: number; lon: number },
): Trail[] {
  if (trails.length <= limit) return trails;

  const ranked = trails.slice().sort((a, b) => {
    if (origin) return haversineMi(origin, a) - haversineMi(origin, b);
    return (b.routes ?? 0) - (a.routes ?? 0);
  });

  return ranked.slice(0, limit);
}

export interface BuildOptions {
  date: string;
  activity: ActivityId;
  trails?: Trail[];
  /** Max areas to score. Defaults to MAX_SCORED. */
  limit?: number;
  /** When given, the cap keeps the nearest areas rather than the biggest. */
  origin?: { lat: number; lon: number };
  /** Extra dates to warm in the same upstream call, e.g. a week view. */
  alsoFetch?: string[];
  signal?: AbortSignal;
}

export interface BuildResult {
  reports: TrailReport[];
  sourceStatus: SourceStatus[];
  degraded: boolean;
  /** Areas actually scored. */
  scored: number;
  /** Areas that matched the activity before the cap was applied. */
  available: number;
}

/**
 * Build scored reports for a set of trails on one date.
 *
 * Trails are clustered onto a coarse grid before fetching, so a canyon with
 * six trailheads costs one upstream request per source rather than six. With
 * the current dataset this is the difference between 3 and 54 calls.
 */
export async function buildReports(options: BuildOptions): Promise<BuildResult> {
  const matching = (options.trails ?? TRAILS).filter((t) =>
    t.activities.includes(options.activity),
  );
  const trails = selectCandidates(matching, options.limit ?? MAX_SCORED, options.origin);

  const dates = [...new Set([options.date, ...(options.alsoFetch ?? [])])];

  const cells = new Map<string, Trail[]>();
  for (const trail of trails) {
    const cell = gridKey(trail);
    const existing = cells.get(cell);
    if (existing) existing.push(trail);
    else cells.set(cell, [trail]);
  }

  const results = await pool(
    [...cells.entries()].map(([cell, cellTrails]) => async () => {
      const gathered = await gather({
        point: gridCentre(cell),
        dates,
        signal: options.signal,
      });

      const conditions = assembleConditions(gathered, options.date);

      const reports: TrailReport[] = cellTrails.map((trail) => ({
        trail,
        conditions,
        verdict: scoreTrail(trail, conditions, options.activity),
      }));

      return { reports, status: gathered.status };
    }),
    CONCURRENCY,
  );

  const reports = results.flatMap((r) => r.reports);
  reports.sort((a, b) => compareVerdicts(a.verdict, b.verdict));

  const sourceStatus = mergeStatus(results.map((r) => r.status));

  return {
    reports,
    sourceStatus,
    degraded: sourceStatus.some((s) => !s.ok),
    scored: trails.length,
    available: matching.length,
  };
}
