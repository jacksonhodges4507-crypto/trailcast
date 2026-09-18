import { TRAILS } from "./trails";
import { gather, mergeStatus } from "./sources";
import { assembleConditions } from "./conditions";
import { scoreTrail, compareVerdicts } from "./scoring";
import { gridCentre, gridKey } from "./geo";
import type { ActivityId, SourceStatus, Trail, TrailReport } from "./types";

export interface BuildOptions {
  date: string;
  activity: ActivityId;
  trails?: Trail[];
  /** Extra dates to warm in the same upstream call, e.g. a week view. */
  alsoFetch?: string[];
  signal?: AbortSignal;
}

export interface BuildResult {
  reports: TrailReport[];
  sourceStatus: SourceStatus[];
  degraded: boolean;
}

/**
 * Build scored reports for a set of trails on one date.
 *
 * Trails are clustered onto a coarse grid before fetching, so a canyon with
 * six trailheads costs one upstream request per source rather than six. With
 * the current dataset this is the difference between 3 and 54 calls.
 */
export async function buildReports(options: BuildOptions): Promise<BuildResult> {
  const trails = (options.trails ?? TRAILS).filter((t) => t.activities.includes(options.activity));

  const dates = [...new Set([options.date, ...(options.alsoFetch ?? [])])];

  const cells = new Map<string, Trail[]>();
  for (const trail of trails) {
    const cell = gridKey(trail);
    const existing = cells.get(cell);
    if (existing) existing.push(trail);
    else cells.set(cell, [trail]);
  }

  const results = await Promise.all(
    [...cells.entries()].map(async ([cell, cellTrails]) => {
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
  );

  const reports = results.flatMap((r) => r.reports);
  reports.sort((a, b) => compareVerdicts(a.verdict, b.verdict));

  const sourceStatus = mergeStatus(results.map((r) => r.status));

  return {
    reports,
    sourceStatus,
    degraded: sourceStatus.some((s) => !s.ok),
  };
}
