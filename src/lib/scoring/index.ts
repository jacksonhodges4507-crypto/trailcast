import { ACTIVITIES } from "../activities";
import type {
  ActivityId,
  Conditions,
  Factor,
  FactorId,
  Grade,
  SourceRef,
  Trail,
  Verdict,
} from "../types";
import { RULES } from "./rules";

export { estimateHours } from "./rules";

const GRADE_LABEL: Record<Grade, string> = {
  prime: "Prime",
  good: "Good",
  marginal: "Marginal",
  poor: "Poor",
  unsafe: "Don't go",
};

export function gradeFor(score: number): Grade {
  if (score >= 85) return "prime";
  if (score >= 70) return "good";
  if (score >= 50) return "marginal";
  return "poor";
}

export function gradeLabel(grade: Grade): string {
  return GRADE_LABEL[grade];
}

function dedupeSources(factors: Factor[]): SourceRef[] {
  const seen = new Map<string, SourceRef>();
  for (const factor of factors) {
    for (const ref of factor.sources) {
      const id = `${ref.sourceId}|${ref.field ?? ""}`;
      if (!seen.has(id)) seen.set(id, ref);
    }
  }
  return [...seen.values()];
}

/**
 * Compose one verdict.
 *
 * Two properties are deliberate:
 *
 *   1. A veto beats the average. A 92-point day with a fire two miles away
 *      is not a 92-point day, and no amount of good weather should be able
 *      to average that away.
 *   2. Missing data lowers `confidence` instead of the score. Scoring an
 *      absent input as zero would quietly turn an outage into bad advice.
 */
export function scoreTrail(
  trail: Trail,
  conditions: Conditions,
  activity: ActivityId,
): Verdict {
  const profile = ACTIVITIES[activity];
  const factors: Factor[] = [];

  let weightedTotal = 0;
  let weightWithData = 0;
  let weightAll = 0;

  for (const [factorId, rule] of Object.entries(RULES) as [FactorId, (typeof RULES)[FactorId]][]) {
    const configuredWeight = profile.weights[factorId] ?? 0;
    if (configuredWeight === 0) continue;

    weightAll += configuredWeight;

    const factor = rule({ trail, conditions, activity });
    factor.weight = configuredWeight;

    if (factor.score !== undefined) {
      weightWithData += configuredWeight;
      weightedTotal += factor.score * configuredWeight;
    }

    factors.push(factor);
  }

  // Normalise the reported weights so the UI can render them as shares.
  for (const factor of factors) {
    factor.weight = weightAll > 0 ? factor.weight / weightAll : 0;
  }

  const hasVeto = factors.some((f) => f.veto === true);
  const score = weightWithData > 0 ? weightedTotal / weightWithData : undefined;
  const confidence = weightAll > 0 ? weightWithData / weightAll : 0;

  const grade: Grade = hasVeto
    ? "unsafe"
    : score !== undefined
      ? gradeFor(score)
      : "marginal";

  return {
    trailId: trail.id,
    activity,
    date: conditions.date,
    score: score !== undefined ? Math.round(score) : undefined,
    grade,
    headline: buildHeadline(grade, factors, score),
    factors,
    sources: dedupeSources(factors),
    confidence,
  };
}

/**
 * A one-line summary built from the factors that actually moved the number,
 * so the headline changes for the same reason the score did.
 */
export function buildHeadline(grade: Grade, factors: Factor[], score?: number): string {
  const label = GRADE_LABEL[grade];

  const vetoed = factors.find((f) => f.veto === true);
  if (vetoed) return `${label} — ${vetoed.reason}`;

  if (score === undefined) {
    return `${label} — not enough data to judge conditions`;
  }

  const scored = factors.filter((f): f is Factor & { score: number } => f.score !== undefined);

  // Rank by how much each factor dragged the composite down.
  const drags = scored
    .map((f) => ({ factor: f, drag: (100 - f.score) * f.weight }))
    .sort((a, b) => b.drag - a.drag);

  const worst = drags[0];

  // Lead a good day with the factor contributing most to the verdict, not
  // merely the highest-scoring one. Daylight scores 100 on almost every
  // summer trail, so ranking by raw score gave every prime trail the same
  // uninformative headline.
  // The absence of a hazard is not news. A perfect wildfire score means no
  // fires nearby, which was leading half the headlines with "no active fire
  // perimeters nearby" while saying nothing about the actual day.
  const newsworthy = scored.filter((f) => !(f.id === "wildfire" && f.score === 100));
  const candidates = newsworthy.length > 0 ? newsworthy : scored;

  const best = candidates
    .map((f) => ({ factor: f, contribution: (f.score / 100) * f.weight }))
    .sort((a, b) => b.contribution - a.contribution)[0];

  if (grade === "prime" && best) {
    return `${label} — ${lowerFirst(best.factor.reason)}`;
  }

  if (worst && worst.drag > 4) {
    return `${label} — ${lowerFirst(worst.factor.reason)}`;
  }

  return `${label} — nothing standing out against it`;
}

/**
 * Lowercase the first character so a reason can be spliced mid-sentence,
 * unless the leading word is an abbreviation or a figure — "AQI 142" must not
 * become "aQI 142", and "12.3 h of daylight" should be left alone.
 */
export function lowerFirst(text: string): string {
  const first = text.split(/\s+/)[0] ?? "";
  if (/^[A-Z]{2,}/.test(first)) return text;
  if (/^[\d\u2013-]/.test(first)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Sort helper: best first, with vetoed trails always last. */
export function compareVerdicts(a: Verdict, b: Verdict): number {
  if (a.grade === "unsafe" && b.grade !== "unsafe") return 1;
  if (b.grade === "unsafe" && a.grade !== "unsafe") return -1;
  return (b.score ?? -1) - (a.score ?? -1);
}
