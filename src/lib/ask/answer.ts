import { TRAILS } from "../trails";
import { buildReports } from "../report";
import { haversineMi, type LatLon } from "../geo";
import { drivePenalty } from "../travel";
import { watersFor } from "../fishing/guide";
import type { SpeciesId } from "../fishing/species";
import { formatDrive } from "../format";
import { readSummaries } from "../reports/service";
import type { ReportSummary } from "../reports/kinds";

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

    if (query.minGainFt !== undefined && trail.gainFt < query.minGainFt) return false;
    if (query.rockType && trail.rockType !== query.rockType) return false;
    if (query.wantsWater && !/\b(lake|falls|waterfall|reservoir|river|creek)\b/i.test(`${trail.name} ${trail.blurb}`)) {
      return false;
    }
    if (query.species && !watersFor(query.species as SpeciesId).includes(trail.id)) return false;

    return true;
  });
}

/**
 * Preferences move a place up the ranking without excluding anything.
 *
 * "Somewhere shady" should favour shaded routes, not hide an exposed one that
 * is dramatically better -- so a matching place gains a few points in the
 * ordering, the same scale the drive-time cost uses, and the score shown on
 * its card is untouched.
 */
export const PREFERENCE_POINTS = 6;

export function preferenceBonus(query: AskQuery, trail: Trail): number {
  let bonus = 0;
  if (query.preferShade && !trail.exposed) bonus += PREFERENCE_POINTS;
  if (query.preferShade && (trail.aspect === "N" || trail.aspect === "NE" || trail.aspect === "NW")) {
    bonus += PREFERENCE_POINTS / 2;
  }
  if (query.preferSun && (trail.aspect === "S" || trail.aspect === "SE" || trail.aspect === "SW")) {
    bonus += PREFERENCE_POINTS;
  }
  return bonus;
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
  query?: AskQuery,
): TrailReport[] {
  const bonus = (r: TrailReport) => (query ? preferenceBonus(query, r.trail) : 0);

  if (!origin) {
    if (!query) return reports;
    return reports.slice().sort((a, b) => {
      if (a.verdict.grade === "unsafe" && b.verdict.grade !== "unsafe") return 1;
      if (b.verdict.grade === "unsafe" && a.verdict.grade !== "unsafe") return -1;
      return (b.verdict.score ?? -1) + bonus(b) - ((a.verdict.score ?? -1) + bonus(a));
    });
  }

  const worth = (r: TrailReport) =>
    (r.verdict.score ?? -1) + bonus(r) - (r.travel ? drivePenalty(r.travel.minutes) : 0);
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
    return `Nothing in the dataset matches ${query.interpretation}. The narrowest part of that is usually the place, the rock type or the fish \u2014 try dropping one.`;
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
      // Scale the caveat to the cost. Twenty minutes for a noticeably better
      // day is an easy call and should read like one; two hours is a real
      // trade-off and should be named as one.
      const pointsPerHour = margin / (extraMinutes / 60);
      sentences.push(
        extraMinutes < 45
          ? `It is ${margin} points better than ${runnerUp.trail.name} for ${formatDrive(extraMinutes)} more each way, which is an easy trade.`
          : pointsPerHour >= 8
            ? `It is ${margin} points better than ${runnerUp.trail.name} but ${formatDrive(extraMinutes)} further each way \u2014 a real trade-off, though the conditions gap justifies it.`
            : `It is ${margin} points better than ${runnerUp.trail.name} but ${formatDrive(extraMinutes)} further each way \u2014 worth it if the day is the point, not if you are short on time.`,
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

  if (query.preferShade && !top.trail.exposed) {
    sentences.push("It is also one of the shaded options, as asked.");
  } else if (query.preferShade && top.trail.exposed) {
    sentences.push("It is exposed rather than shaded, but the conditions gap outweighed that.");
  }

  const crowd = crowdSentence(top);
  if (crowd) sentences.push(crowd);

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

/**
 * Add confirmed visitor reports to the shortlisted places. Only the top few
 * are looked up, and a store outage simply leaves them off.
 */
export async function attachCrowdReports(reports: TrailReport[]): Promise<TrailReport[]> {
  if (reports.length === 0) return reports;
  let summaries: Map<string, ReportSummary>;
  try {
    summaries = await readSummaries(reports.map((r) => r.trail.id));
  } catch {
    return reports;
  }
  return reports.map((r) => {
    const confirmed = summaries.get(r.trail.id)?.confirmed ?? [];
    return confirmed.length > 0 ? { ...r, crowd: confirmed } : r;
  });
}

/** One sentence on what visitors confirmed at the pick, if anything. */
export function crowdSentence(report: TrailReport): string | null {
  const crowd = report.crowd ?? [];
  if (crowd.length === 0) return null;
  const worrying = crowd.filter((c) => c.tone !== "good");
  const shown = (worrying.length > 0 ? worrying : crowd).slice(0, 2);
  const list = shown
    .map((c) => `${c.label.toLowerCase()} (${c.reporters} people)`)
    .join(" and ");
  return worrying.length > 0
    ? `Visitors in the last 48 h report ${list} there — not measured, but worth weighing.`
    : `Visitors in the last 48 h back that up: ${list}.`;
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

  const ranked = rankByProximity(built.reports, query.origin, query).slice(0, 5);
  const results = await attachCrowdReports(ranked);

  const llmNarrative = useLlm ? await narrate(query, results) : null;

  return {
    query,
    narrative: llmNarrative ?? templateNarrative(query, results, today),
    results,
    sourceStatus: built.sourceStatus,
    narratedBy: llmNarrative ? "llm" : "template",
  };
}
