import type { Grade } from "@/lib/types";

export const GRADE_COLOR: Record<Grade, string> = {
  prime: "#34d399",
  good: "#a3e635",
  marginal: "#fbbf24",
  poor: "#fb923c",
  unsafe: "#f43f5e",
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
  if (score === undefined) return "#647a72";
  return GRADE_COLOR[grade];
}
