import { TRAILS, getTrail } from "../trails";
import { buildReports } from "../report";
import { haversineMi, type LatLon } from "../geo";
import { drivePenalty } from "../travel";
import { holdsSpecies } from "../fishing/guide";
import type { SpeciesId } from "../fishing/species";
import { formatDrive } from "../format";
import { readSummaries } from "../reports/service";
import type { ReportSummary } from "../reports/kinds";

export { formatDrive };
import { gradeLabel, lowerFirst } from "../scoring";
import { relativeLabel, todayIso } from "../dates";
import { parseQuery } from "./parse";
import { isLlmEnabled, narrate, narrateUnknown, refineQuery } from "./llm";
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
  // When the question names a place, the answer is about that place. Filters
  // built for a search ("under 5 mi", "near Provo") would only get in the way.
  if (query.subject) {
    const named = [query.subject, ...(query.subjectAlternatives ?? [])]
      .map(getTrail)
      .filter((t): t is Trail => t !== undefined)
      .filter((t) => t.id === query.subject || t.activities.includes(query.activity));
    if (named.length > 0) return named;
  }

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
    if (query.species && !holdsSpecies(trail, query.species as SpeciesId)) return false;

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

const ACTIVITY_DAY: Record<string, string> = {
  hike: "hiking",
  trail_run: "running",
  mtb: "riding",
  climb: "climbing",
  fish: "fishing",
};

/** Pick one phrasing per place, so answers vary but stay reproducible. */
function pick<T>(options: T[], seed: string): T {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return options[hash % options.length]!;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Scout's deterministic voice.
 *
 * It talks the way a friend who knows the area would: a recommendation, the
 * reason in one breath, what the runner-up offers, and one heads-up. It used
 * to read like a report card on the top result ("X is the pick -- prime at
 * 95, 7 mi and 200 ft of gain"), which answered the question but did not
 * sound like anyone answering it.
 *
 * This is still the reference implementation, not a consolation prize: it
 * makes the same comparison the language model is asked to, from the same
 * facts, so Scout is fully testable and useful with no API key at all.
 */
/**
 * The answer to "what is X" / "how's X looking".
 *
 * A place the reader already has in mind does not need a recommendation; it
 * needs to be told what the place is, how it is today, and honestly whether
 * a different place of the same name might be the one they meant.
 */
function subjectNarrative(
  query: AskQuery,
  reports: TrailReport[],
  top: TrailReport,
  when: string,
  doing: string,
): string {
  const trail = top.trail;
  const sentences: string[] = [`${trail.name} is in ${trail.region}. ${trail.blurb}`];

  const vetoed = top.verdict.factors.find((f) => f.veto);
  if (top.verdict.grade === "unsafe" && vetoed) {
    sentences.push(`I wouldn't go ${when} though — ${lowerFirst(vetoed.reason)}.`);
  } else if (top.verdict.score !== undefined) {
    sentences.push(
      `For ${doing} ${when} it scores ${top.verdict.score} out of 100 — ${gradeLabel(top.verdict.grade).toLowerCase()}.`,
    );
    const best = top.verdict.factors
      .filter((f): f is typeof f & { score: number } => f.score !== undefined)
      .sort((a, b) => b.weight * b.score - a.weight * a.score)[0];
    if (best) sentences.push(capitalise(lowerFirst(best.reason)) + ".");
  } else {
    sentences.push(`I couldn't get conditions for it ${when}, so I can't tell you how it is right now.`);
  }

  const weakest = top.verdict.factors
    .filter((f): f is typeof f & { score: number } => f.score !== undefined)
    .sort((a, b) => a.score - b.score)[0];
  if (weakest && weakest.score < 75) sentences.push(`One heads-up: ${lowerFirst(weakest.reason)}.`);

  const crowd = crowdSentence(top);
  if (crowd) sentences.push(crowd);

  // Utah has four Mill Creeks. Say so rather than quietly picking one.
  const others = reports
    .filter((r) => r.trail.id !== trail.id)
    .slice(0, 2)
    .map((r) => `${r.trail.name} in ${r.trail.region}`);
  if (others.length > 0) {
    sentences.push(
      `If you meant a different one, I also have ${others.join(" and ")} — tap either to switch.`,
    );
  }

  return sentences.join(" ");
}

export function templateNarrative(
  query: AskQuery,
  reports: TrailReport[],
  today: string,
): string {
  const when = relativeLabel(query.date, today);
  const doing = ACTIVITY_DAY[query.activity] ?? "getting out";

  const top = reports[0];

  // Saying "I don't have that" is a better answer than a confident wrong one.
  if (!top && query.unknownPlace) {
    return `I don't have ${query.unknownPlace} in my data, so I'd only be guessing. I cover Utah: every water the DWR stocks, the climbing areas on OpenBeta, and a hand-built set of trails. Try the name the way it appears on a map, or ask me what's good near a town instead.`;
  }
  if (!top) {
    return `I couldn't find anywhere for ${query.interpretation}. Nothing in the dataset matches all of that at once, so try dropping one part of it: usually the place, the rock type or the fish.`;
  }

  // The question named a place, so answer about that place rather than
  // pretending it was a search for somewhere to go.
  if (query.subject && top.trail.id === query.subject) {
    return subjectNarrative(query, reports, top, when, doing);
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
      ? ` I'd go to ${alternative.trail.name} instead; it doesn't have that problem and scores ${alternative.verdict.score ?? "?"}.`
      : " Nothing else in range is clear either, so I'd pick another day.";
    return `Don't go to ${top.trail.name} ${when}. It would otherwise be a good call, but ${lowerFirst(vetoed.reason)}.${redirect}`;
  }

  const sentences: string[] = [];
  const seed = `${top.trail.id}|${query.date}|${query.interpretation}`;

  const near = top.travel
    ? ` (${formatDrive(top.travel.minutes)} drive${top.travel.source === "estimate" ? ", roughly" : ""})`
    : query.origin
      ? ` (${Math.round(haversineMi(query.origin, top.trail))} mi from ${query.origin.label})`
      : "";
  const name = `${top.trail.name}${near}`;
  const grade = top.verdict.grade;

  if (grade === "prime" || grade === "good") {
    sentences.push(
      pick(
        [
          `${capitalise(when)} looks like a good day for ${doing}. I'd head to ${name}.`,
          `If I were going ${doing} ${when}, I'd go to ${name}.`,
          `${name} is where I'd be ${when}.`,
        ],
        seed,
      ),
    );
  } else if (grade === "marginal") {
    sentences.push(
      `${capitalise(when)} is a so-so day for ${doing}. Your best bet is ${name}, but keep your expectations in check.`,
    );
  } else {
    sentences.push(
      `${capitalise(when)} isn't great for ${doing} anywhere I looked. The least-bad option is ${name}.`,
    );
  }

  // The reason, from its two strongest heavily weighted factors.
  const strengths = scored(top)
    .filter((f) => f.score >= 80)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2);
  if (strengths.length === 2) {
    sentences.push(`${capitalise(lowerFirst(strengths[0]!.reason))}, and ${lowerFirst(strengths[1]!.reason)}.`);
  } else if (strengths.length === 1) {
    sentences.push(`The big thing going for it: ${lowerFirst(strengths[0]!.reason)}.`);
  }

  /*
   * The comparison is the part worth saying. A ranked list already shows
   * which is first; what it cannot say is what separates first from second,
   * which is what tells you whether the order matters to you.
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

    // The drive trade-off, scaled to what it costs: twenty minutes for a
    // noticeably better day is an easy call; two hours is a real decision.
    if (extraMinutes >= 20 && margin > 0) {
      const pointsPerHour = margin / (extraMinutes / 60);
      sentences.push(
        extraMinutes < 45
          ? `It's ${margin} points better than ${runnerUp.trail.name} for ${formatDrive(extraMinutes)} more each way, which is an easy trade.`
          : pointsPerHour >= 8
            ? `It's ${margin} points better than ${runnerUp.trail.name} but ${formatDrive(extraMinutes)} further each way. That's a real trade-off, though I think the conditions are worth it.`
            : `It's ${margin} points better than ${runnerUp.trail.name} but ${formatDrive(extraMinutes)} further each way, so it's worth it if the day is the point, not if you're short on time.`,
      );
    } else if (extraMinutes <= -20) {
      sentences.push(
        `It also beats ${runnerUp.trail.name} (${runnerUp.verdict.score ?? "?"}) on the drive, by ${formatDrive(-extraMinutes)} each way.`,
      );
    } else if (margin <= 3) {
      sentences.push(
        `${runnerUp.trail.name} (${runnerUp.verdict.score ?? "?"}) is basically just as good, so go with whichever is easier for you to get to.`,
      );
    } else if (widest && widest.gap > 2 && widest.better && widest.worse) {
      sentences.push(
        `If that doesn't work, ${runnerUp.trail.name} (${runnerUp.verdict.score ?? "?"}) is the backup; it loses mostly on ${widest.label}, ${widest.worse} against ${widest.better}.`,
      );
    } else {
      sentences.push(`If that doesn't work, ${runnerUp.trail.name} (${runnerUp.verdict.score ?? "?"}) is a solid backup.`);
    }
  }

  if (query.preferShade && !top.trail.exposed) {
    sentences.push("It's one of the shadier options too, like you asked.");
  } else if (query.preferShade && top.trail.exposed) {
    sentences.push("It's more exposed than you wanted, but the conditions gap made up for it.");
  }

  const crowd = crowdSentence(top);
  if (crowd) sentences.push(crowd);

  // Always name a downside. A recommendation with no caveat is the least
  // useful kind, even when the day genuinely is good.
  const weakest = scored(top).slice().sort((a, b) => a.score - b.score)[0];
  if (weakest && weakest.score < 75) {
    sentences.push(`One heads-up: ${lowerFirst(weakest.reason)}.`);
  }

  const missing = top.verdict.factors.filter((f) => f.score === undefined);
  if (missing.length > 0) {
    sentences.push(
      `I don't have ${missing.map((f) => f.label.toLowerCase()).join(" or ")} data for it, so I can't vouch for that part.`,
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

  /*
   * The question named a place and we don't hold it. Returning the generic
   * search anyway is how "whats the jordan river resivar" came back as
   * Angels Landing — so answer with nothing, and say why.
   */
  const candidates = query.unknownPlace ? [] : applyFilters(query);

  const built = await buildReports({
    date: query.date,
    activity: query.activity,
    trails: candidates,
    origin: query.origin,
    signal: options.signal,
  });

  let ranked = rankByProximity(built.reports, query.origin, query);
  // A question about a place is answered about that place, whatever the
  // ranking would otherwise prefer.
  if (query.subject) {
    const i = ranked.findIndex((r) => r.trail.id === query.subject);
    if (i > 0) ranked = [ranked[i]!, ...ranked.filter((_, j) => j !== i)];
  }
  const results = await attachCrowdReports(ranked.slice(0, 5));

  const llmNarrative = useLlm
    ? query.unknownPlace
      ? await narrateUnknown(options.question, query.unknownPlace, query.date)
      : await narrate(query, results)
    : null;

  return {
    query,
    narrative: llmNarrative ?? templateNarrative(query, results, today),
    results,
    sourceStatus: built.sourceStatus,
    narratedBy: llmNarrative ? "llm" : "template",
  };
}
