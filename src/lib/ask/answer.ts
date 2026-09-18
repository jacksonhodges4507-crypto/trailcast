import { TRAILS } from "../trails";
import { buildReports } from "../report";
import { haversineMi } from "../geo";
import { gradeLabel, lowerFirst } from "../scoring";
import { relativeLabel, todayIso } from "../dates";
import { parseQuery } from "./parse";
import { isLlmEnabled, narrate, refineQuery } from "./llm";
import type { AskAnswer, AskQuery, Trail, TrailReport } from "../types";

/**
 * Naming a place without giving a radius still means "near there". Without
 * this default, "where should I ride near Park City" searched the whole
 * dataset and cheerfully recommended a trail on the far side of the valley.
 */
export const DEFAULT_NEARBY_RADIUS_MI = 50;

/** Verdicts within this many points are a tie on conditions. */
export const TIE_POINTS = 3;

export function radiusFor(query: AskQuery): number | undefined {
  if (query.withinMi !== undefined) return query.withinMi;
  return query.origin ? DEFAULT_NEARBY_RADIUS_MI : undefined;
}

function applyFilters(query: AskQuery): Trail[] {
  const radius = radiusFor(query);

  return TRAILS.filter((trail) => {
    if (!trail.activities.includes(query.activity)) return false;
    if (query.maxDistanceMi !== undefined && trail.distanceMi > query.maxDistanceMi) return false;
    if (query.maxGainFt !== undefined && trail.gainFt > query.maxGainFt) return false;

    if (query.origin && radius !== undefined) {
      if (haversineMi(query.origin, trail) > radius) return false;
    }

    return true;
  });
}

/**
 * When the user named an origin, break near-ties on conditions by distance.
 * A trail eight miles away and one point worse is the better answer to
 * "where should I ride near Park City" than one thirty miles away.
 */
export function rankByProximity(
  reports: TrailReport[],
  origin?: { lat: number; lon: number },
): TrailReport[] {
  if (!origin) return reports;

  return reports.slice().sort((a, b) => {
    // A no-go stays last regardless of how close it is.
    if (a.verdict.grade === "unsafe" && b.verdict.grade !== "unsafe") return 1;
    if (b.verdict.grade === "unsafe" && a.verdict.grade !== "unsafe") return -1;

    const scoreDelta = (b.verdict.score ?? -1) - (a.verdict.score ?? -1);
    if (Math.abs(scoreDelta) > TIE_POINTS) return scoreDelta;

    return haversineMi(origin, a.trail) - haversineMi(origin, b.trail);
  });
}

/**
 * Deterministic narrator.
 *
 * Produces the same grounded summary the model is asked for, from the same
 * facts. Because it exists, the ask endpoint has no hard dependency on an API
 * key and its behaviour is unit-testable.
 */
export function templateNarrative(
  query: AskQuery,
  reports: TrailReport[],
  today: string,
): string {
  const when = relativeLabel(query.date, today);

  const top = reports[0];
  if (!top) {
    return `Nothing in the dataset matches ${query.interpretation}. Try widening the radius or dropping a filter.`;
  }

  if (top.verdict.grade === "unsafe") {
    return `Nothing looks safe ${when}. The best-scoring option, ${top.trail.name}, is still a no: ${lowerFirst(top.verdict.headline)}. Pick another day.`;
  }

  const scored = top.verdict.factors.filter(
    (f): f is typeof f & { score: number } => f.score !== undefined,
  );

  const weakest = scored.slice().sort((a, b) => a.score - b.score)[0];
  const strongest = scored
    .map((f) => ({ factor: f, contribution: (f.score / 100) * f.weight }))
    .sort((a, b) => b.contribution - a.contribution)[0];

  const near = query.origin ? ` (${Math.round(haversineMi(query.origin, top.trail))} mi from ${query.origin.label})` : "";

  const sentences = [
    `${top.trail.name} in ${top.trail.region}${near} is the pick ${when} — ${gradeLabel(top.verdict.grade).toLowerCase()} at ${top.verdict.score ?? "?"}/100, ${top.trail.distanceMi} mi and ${top.trail.gainFt.toLocaleString()} ft of gain.`,
  ];

  if (weakest && weakest.score < 70) {
    sentences.push(`The catch: ${lowerFirst(weakest.reason)}.`);
  } else if (strongest) {
    sentences.push(`Conditions are in your favour: ${lowerFirst(strongest.factor.reason)}.`);
  }

  const runnerUp = reports[1];
  if (runnerUp && runnerUp.verdict.grade !== "unsafe") {
    sentences.push(
      `${runnerUp.trail.name} is the next best at ${runnerUp.verdict.score ?? "?"}/100 if you want something different.`,
    );
  }

  return sentences.join(" ");
}

export interface AskOptions {
  question: string;
  today?: string;
  /** Set false to force the deterministic path, used by tests. */
  allowLlm?: boolean;
  signal?: AbortSignal;
}

export async function ask(options: AskOptions): Promise<AskAnswer> {
  const today = options.today ?? todayIso();
  const useLlm = (options.allowLlm ?? true) && isLlmEnabled();

  const baseQuery = parseQuery(options.question, today);
  const query = useLlm ? await refineQuery(options.question, today, baseQuery) : baseQuery;

  const candidates = applyFilters(query);

  const built = await buildReports({
    date: query.date,
    activity: query.activity,
    trails: candidates,
    origin: query.origin,
    signal: options.signal,
  });

  const results = rankByProximity(built.reports, query.origin).slice(0, 5);

  const llmNarrative = useLlm ? await narrate(query, results) : null;

  return {
    query,
    narrative: llmNarrative ?? templateNarrative(query, results, today),
    results,
    sourceStatus: built.sourceStatus,
    narratedBy: llmNarrative ? "llm" : "template",
  };
}
