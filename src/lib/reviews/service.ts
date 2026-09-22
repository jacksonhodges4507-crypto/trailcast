import { getTrail } from "../trails";
import { reporterId } from "../reports/service";
import { reportStore } from "../reports/store";
import { sanitizeNote } from "../reports/kinds";
import { summarizeReviews, VERDICT_BY_ID, type ReviewSummary } from "./kinds";

/** Reviews a person may leave per hour, across all places. */
export const REVIEW_LIMIT_PER_HOUR = 6;

export async function readReviews(trailId: string): Promise<ReviewSummary> {
  return summarizeReviews(await reportStore().list(trailId, "reviews"));
}

export type ReviewResult =
  | { ok: true; summary: ReviewSummary }
  | { ok: false; status: number; error: string };

export async function submitReview(input: {
  trailId: unknown;
  verdict: unknown;
  note: unknown;
  address: string;
}): Promise<ReviewResult> {
  const trail = typeof input.trailId === "string" ? getTrail(input.trailId) : undefined;
  if (!trail) return { ok: false, status: 400, error: "Unknown place." };

  const verdict = typeof input.verdict === "string" ? VERDICT_BY_ID[input.verdict] : undefined;
  if (!verdict) return { ok: false, status: 400, error: "Unknown verdict." };

  const who = reporterId(input.address);
  const store = reportStore();

  const count = await store.hit(`review:${who}`, 3600);
  if (count > REVIEW_LIMIT_PER_HOUR) {
    return { ok: false, status: 429, error: "That is a lot of reviews in an hour — try again later." };
  }

  await store.append(
    trail.id,
    { kind: verdict.id, note: sanitizeNote(input.note), at: new Date().toISOString(), who },
    "reviews",
  );

  return { ok: true, summary: summarizeReviews(await store.list(trail.id, "reviews")) };
}
