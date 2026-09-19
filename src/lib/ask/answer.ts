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
 * This is the reference implementation, not a consolation prize: it answers
 * the same question the model is asked -- why this one and not that one --
 * from the same facts, so the ask feature is fully testable without a network
 * call and behaves sensibly with no API key at all.
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

  const scored = (report: TrailReport) =>
    report.verdict.factors.filter(
      (f): f is typeof f & { score: number } => f.score !== undefined,
    );

  // A veto is a different kind of answer, so it gets a different sentence.
  const vetoed = top.verdict.factors.find((f) => f.veto);
  if (top.verdict.grade === "unsafe" && vetoed) {
    const alternative = reports.find((r) => r.verdict.grade !== "unsafe");
    const redirect = alternative
      ? ` ${alternative.trail.name} has no such problem and scores ${alternative.verdict.score ?? "?"}.`
      : " Nothing else in range is clear either — pick another day.";
    return `Don't go ${when}. ${top.trail.name} otherwise scores well, but ${lowerFirst(vetoed.reason)}${redirect}`;
  }

  const sentences: string[] = [];

  const near = query.origin
    ? ` (${Math.round(haversineMi(query.origin, top.trail))} mi from ${query.origin.label})`
    : "";

  sentences.push(
    `${top.trail.name} in ${top.trail.region}${near} is the pick ${when} — ${gradeLabel(top.verdict.grade).toLowerCase()} at ${top.verdict.score ?? "?"}, ${top.trail.distanceMi} mi and ${top.trail.gainFt.toLocaleString()} ft of gain.`,
  );

  /*
   * The comparison is the part worth writing. A ranked list already says
   * which is first; what it cannot say is what separates first from second,
   * which is the thing that tells you whether the order matters to you.
   */
  const runnerUp = reports.find(
    (r) => r.trail.id !== top.trail.id && r.verdict.grade !== "unsafe",
  );

  if (runnerUp) {
    const topFactors = scored(top);
    const upFactors = scored(runnerUp);

    let widest: { label: string; gap: number; better: string; worse: string } | null = null;
    for (const factor of topFactors) {
      const counterpart = upFactors.find((f) => f.id === factor.id);
      if (!counterpart) continue;
      const gap = Math.abs(factor.score - counterpart.score) * factor.weight;
      if (!widest || gap > widest.gap) {
        widest = {
          label: factor.label.toLowerCase(),
          gap,
          better: factor.score >= counterpart.score ? factor.display ?? "" : counterpart.display ?? "",
          worse: factor.score >= counterpart.score ? counterpart.display ?? "" : factor.display ?? "",
        };
      }
    }

    const margin = (top.verdict.score ?? 0) - (runnerUp.verdict.score ?? 0);

    if (widest && widest.gap > 2 && widest.better && widest.worse) {
      sentences.push(
        `It edges out ${runnerUp.trail.name} (${runnerUp.verdict.score ?? "?"}) on ${widest.label} — ${widest.better} against ${widest.worse}.`,
      );
    } else if (margin <= 3) {
      sentences.push(
        `${runnerUp.trail.name} at ${runnerUp.verdict.score ?? "?"} is effectively the same day, so take whichever is closer.`,
      );
    } else {
      sentences.push(`${runnerUp.trail.name} is next at ${runnerUp.verdict.score ?? "?"}.`);
    }
  }

  // Always name a downside. A recommendation with no caveat is the least
  // useful kind, even when the day genuinely is good.
  const weakest = scored(top).slice().sort((a, b) => a.score - b.score)[0];
  if (weakest && weakest.score < 75) {
    sentences.push(`Worth knowing: ${lowerFirst(weakest.reason)}.`);
  }

  const missing = top.verdict.factors.filter((f) => f.score === undefined);
  if (missing.length > 0) {
    sentences.push(
      `No data for ${missing.map((f) => f.label.toLowerCase()).join(" or ")}, so that is unaccounted for.`,
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
