import type { Grade } from "@/lib/types";

/*
 * CSS variables rather than hex values, so the pins, rating steps and legend
 * all follow the active theme without the component knowing there is one.
 */
export const GRADE_COLOR: Record<Grade, string> = {
  prime: "var(--grade-prime)",
  good: "var(--grade-good)",
  marginal: "var(--grade-marginal)",
  poor: "var(--grade-poor)",
  unsafe: "var(--grade-unsafe)",
};

export const GRADE_CLASS: Record<Grade, string> = {
  prime: "grade-prime",
  good: "grade-good",
  marginal: "grade-marginal",
  poor: "grade-poor",
  unsafe: "grade-unsafe",
};

export const GRADE_TEXT: Record<Grade, string> = {
  prime: "Prime",
  good: "Good",
  marginal: "Marginal",
  poor: "Poor",
  unsafe: "No-go",
};

/** Colour a 0-100 score on the same scale the grades use. */
export function scoreColor(score: number | undefined, grade: Grade): string {
  if (score === undefined) return "var(--text-faint)";
  return GRADE_COLOR[grade];
}

/**
 * Per-factor rating.
 *
 * Five named steps rather than a percentage. The underlying 0-100 score is a
 * comparison device, not a measurement: a temperature is not 87% of anything,
 * and printing it that way implies a precision the model does not have. Five
 * discrete steps read as a judgement, which is what it actually is.
 */
export type Rating = "excellent" | "good" | "fair" | "poor" | "critical";

export const RATINGS: Rating[] = ["critical", "poor", "fair", "good", "excellent"];

export function ratingFor(score: number): Rating {
  if (score >= 85) return "excellent";
  if (score >= 68) return "good";
  if (score >= 48) return "fair";
  if (score >= 25) return "poor";
  return "critical";
}

export const RATING_COLOR: Record<Rating, string> = {
  excellent: "var(--grade-prime)",
  good: "var(--grade-good)",
  fair: "var(--grade-marginal)",
  poor: "var(--grade-poor)",
  critical: "var(--grade-unsafe)",
};

/** Filled segments out of five. */
export function ratingSteps(score: number): number {
  return Math.max(1, Math.min(5, Math.ceil(score / 20)));
}
