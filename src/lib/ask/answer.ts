import { TRAILS } from "../trails";
import { buildReports } from "../report";
import { haversineMi, type LatLon } from "../geo";
import { drivePenalty } from "../travel";
import { formatDrive } from "../format";

export { formatDrive };
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
  // "Near Park City" implies a radius. Sharing your location does not: it
  // means "account for the drive", not "only show me what is close", so a
  // superb day two hours away stays in contention and the trade-off is
  // weighed rather than filtered out.
  return query.origin && query.originSource !== "device" ? DEFAULT_NEARBY_RADIUS_MI : undefined;
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
 * Rank by whether a place is worth going to from here, not just by how good
 * it is.
 *
 * With drive times available, each option's conditions score is discounted
 * by the cost of getting there (see drivePenalty). Without them, a named
 * origin still breaks near-ties by straight-line distance. Either way the
 * conditions score shown on the card is untouched: how good a crag is today
 * is a fact about the crag; whether it is worth the drive is a fact about you.
 */
export function rankByProximity(
  reports: TrailReport[],
  origin?: { lat: number; lon: number },
): TrailReport[] {
  if (!origin) return reports;

  const worth = (r: TrailReport) =>
    (r.verdict.score ?? -1) - (r.travel ? drivePenalty(r.travel.minutes) : 0);
  const cost = (r: TrailReport) =>
    r.travel ? r.travel.minutes : haversineMi(origin, r.trail);

  return reports.slice().sort((a, b) => {
    // A no-go stays last however close it is.
    if (a.verdict.grade === "unsafe" && b.verdict.grade !== "unsafe") return 1;
    if (b.verdict.grade === "unsafe" && a.verdict.grade !== "unsafe") return -1;

    const delta = worth(b) - worth(a);
    if (Math.abs(delta) > TIE_POINTS) return delta;

    return cost(a) - cost(b);
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

  const near = top.travel
    ? ` (${formatDrive(top.travel.minutes)} drive${top.travel.source === "estimate" ? ", estimated" : ""})`
    : query.origin
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
    const extraMinutes =
      top.travel && runnerUp.travel ? top.travel.minutes - runnerUp.travel.minutes : 0;

    /*
     * The trade-off sentence. When the pick is further than the runner-up,
     * the honest recommendation says what the extra drive buys -- and when
     * the pick is the closer one, the drive is worth mentioning as a point in
     * its favour. This is the comparison drive time exists to make possible.
     */
    if (extraMinutes >= 20 && margin > 0) {
      sentences.push(
        `It is ${margin} points better than ${runnerUp.trail.name} but ${formatDrive(extraMinutes)} further each way — worth it if the day is the point, not if you are short on time.`,
      );
    } else if (extraMinutes <= -20) {
      sentences.push(
        `It also beats ${runnerUp.trail.name} (${runnerUp.verdict.score ?? "?"}) on the drive, by ${formatDrive(-extraMinutes)} each way.`,
      );
    } else if (widest && widest.gap > 2 && widest.better && widest.worse) {
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
  /** The viewer's own location, already coarsened. Never stored. */
  deviceOrigin?: LatLon;
  today?: string;
  /** Set false to force the deterministic path, used by tests. */
  allowLlm?: boolean;
  signal?: AbortSignal;
}

export async function ask(options: AskOptions): Promise<AskAnswer> {
  const today = options.today ?? todayIso();
  const useLlm = (options.allowLlm ?? true) && isLlmEnabled();

  const baseQuery = parseQuery(options.question, today);
  const refined = useLlm ? await refineQuery(options.question, today, baseQuery) : baseQuery;

  // A place named in the question wins over the device: "near Moab" asked
  // from Provo means Moab.
  const query: AskQuery =
    refined.origin || !options.deviceOrigin
      ? { ...refined, originSource: refined.origin ? "place" : refined.originSource }
      : {
          ...refined,
          origin: { ...options.deviceOrigin, label: "your location" },
          originSource: "device",
          interpretation: `${refined.interpretation}, from your location`,
        };

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
