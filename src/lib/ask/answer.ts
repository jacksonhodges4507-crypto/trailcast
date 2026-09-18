import { TRAILS } from "../trails";
import { buildReports } from "../report";
import { haversineMi } from "../geo";
import { gradeLabel } from "../scoring";
import { relativeLabel, todayIso } from "../dates";
import { parseQuery } from "./parse";
import { isLlmEnabled, narrate, refineQuery } from "./llm";
import type { AskAnswer, AskQuery, Trail, TrailReport } from "../types";

function applyFilters(query: AskQuery): Trail[] {
  return TRAILS.filter((trail) => {
    if (!trail.activities.includes(query.activity)) return false;
    if (query.maxDistanceMi !== undefined && trail.distanceMi > query.maxDistanceMi) return false;
    if (query.maxGainFt !== undefined && trail.gainFt > query.maxGainFt) return false;

    if (query.origin && query.withinMi !== undefined) {
      if (haversineMi(query.origin, trail) > query.withinMi) return false;
    }

    return true;
  });
}

/**
 * Deterministic narrator.
 *
 * Produces the same grounded summary the model is asked for, from the same
 * facts. Because it exists, the ask endpoint has no hard dependency on an API
 * key and its behaviour is unit-testable.
 */
export function templateNarrative(query: AskQuery, reports: TrailReport[], today: string): string {
  const when = relativeLabel(query.date, today);

  if (reports.length === 0) {
    return `Nothing in the dataset matches ${query.interpretation}. Try widening the radius or dropping a filter.`;
  }

  const top = reports[0];
  if (!top) {
    return `Nothing in the dataset matches ${query.interpretation}.`;
  }

  if (top.verdict.grade === "unsafe") {
    return `Nothing looks safe ${when}. The best-scoring option, ${top.trail.name}, is still a no: ${top.verdict.headline.toLowerCase()}. Pick another day.`;
  }

  const worst = top.verdict.factors
    .filter((f) => f.score !== undefined)
    .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))[0];

  const runnerUp = reports[1];

  const sentences = [
    `${top.trail.name} in ${top.trail.region} is the pick ${when} — ${gradeLabel(top.verdict.grade).toLowerCase()} at ${top.verdict.score ?? "?"}/100, ${top.trail.distanceMi} mi and ${top.trail.gainFt.toLocaleString()} ft of gain.`,
  ];

  if (worst && (worst.score ?? 100) < 70) {
    sentences.push(`The catch: ${worst.reason.toLowerCase()}.`);
  } else {
    sentences.push(`Nothing is working against it: ${top.verdict.headline.toLowerCase()}.`);
  }

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
    signal: options.signal,
  });

  const results = built.reports.slice(0, 5);

  const llmNarrative = useLlm ? await narrate(query, results) : null;

  return {
    query,
    narrative: llmNarrative ?? templateNarrative(query, results, today),
    results,
    sourceStatus: built.sourceStatus,
    narratedBy: llmNarrative ? "llm" : "template",
  };
}
