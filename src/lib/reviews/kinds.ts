import { sanitizeNote } from "../reports/kinds";
import type { StoredReport } from "../reports/kinds";

/**
 * Was it worth going?
 *
 * Condition reports answer "what is it like today"; they expire in 48 hours
 * and that is right, because mud dries. This answers a different question —
 * "is this place worth my Saturday" — which does not expire, and which the
 * forecast cannot answer at all. A score of 92 tells you the weather is good
 * for walking; it cannot tell you the trail is a gravel road beside a
 * highway.
 *
 * Three buttons, not five stars. A star average hides the shape of the
 * opinion, and nobody agrees what three stars means; "would you go back" is
 * a question everyone answers the same way.
 */

export type VerdictId = "worth-it" | "mixed" | "skip";

export interface ReviewVerdict {
  id: VerdictId;
  label: string;
  glyph: string;
  ask: string;
}

export const VERDICTS: ReviewVerdict[] = [
  { id: "worth-it", label: "Worth it", glyph: "\u{1F44D}", ask: "I'd go back" },
  { id: "mixed", label: "It was fine", glyph: "\u{1F937}", ask: "Glad I saw it once" },
  { id: "skip", label: "I'd skip it", glyph: "\u{1F44E}", ask: "Not worth the trip" },
];

export const VERDICT_BY_ID: Record<string, ReviewVerdict> = Object.fromEntries(
  VERDICTS.map((v) => [v.id, v]),
);

/** A note is only shown once this many different people have reviewed. */
export const REVIEWS_BEFORE_NOTES = 2;

export interface ReviewNote {
  verdict: VerdictId;
  note: string;
  at: string;
}

export interface ReviewSummary {
  /** Distinct people per verdict. */
  counts: Record<VerdictId, number>;
  /** Distinct people who have reviewed at all. */
  total: number;
  /** Share who said "worth it", 0-100, or null below the threshold. */
  worthItPct: number | null;
  /** One line of plain English, or null when nobody has said anything yet. */
  headline: string | null;
  notes: ReviewNote[];
}

const EMPTY: Record<VerdictId, number> = { "worth-it": 0, mixed: 0, skip: 0 };

/**
 * Collapse reviews into what may be shown.
 *
 * One person, one vote: only a reviewer's most recent verdict counts, so
 * changing your mind updates your answer rather than adding a second one.
 */
export function summarizeReviews(reviews: StoredReport[]): ReviewSummary {
  const latest = new Map<string, StoredReport>();
  for (const review of reviews) {
    if (!VERDICT_BY_ID[review.kind]) continue;
    if (!Number.isFinite(Date.parse(review.at))) continue;
    const held = latest.get(review.who);
    if (!held || review.at > held.at) latest.set(review.who, review);
  }

  const counts = { ...EMPTY };
  const notes: ReviewNote[] = [];
  for (const review of latest.values()) {
    counts[review.kind as VerdictId] += 1;
    if (review.note) {
      notes.push({ verdict: review.kind as VerdictId, note: review.note, at: review.at });
    }
  }

  const total = latest.size;
  const worthItPct = total >= REVIEWS_BEFORE_NOTES
    ? Math.round((counts["worth-it"] / total) * 100)
    : null;

  notes.sort((a, b) => b.at.localeCompare(a.at));

  return {
    counts,
    total,
    worthItPct,
    headline: headlineFor(total, worthItPct),
    // A lone note is one stranger's opinion presented as the record; hold it
    // back until someone else has weighed in.
    notes: total >= REVIEWS_BEFORE_NOTES ? notes.slice(0, 4) : [],
  };
}

function headlineFor(total: number, worthItPct: number | null): string | null {
  if (total === 0) return null;
  const people = `${total} ${total === 1 ? "person has" : "people have"} been`;
  if (worthItPct === null) return `${people} — not enough yet to call it.`;
  if (worthItPct >= 80) return `${worthItPct}% of ${total} would go back.`;
  if (worthItPct >= 50) return `${worthItPct}% of ${total} would go back — worth a look, not a pilgrimage.`;
  if (worthItPct >= 25) return `Only ${worthItPct}% of ${total} would go back.`;
  return `Almost nobody of the ${total} who went would go back.`;
}

export { sanitizeNote };
