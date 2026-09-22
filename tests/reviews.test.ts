import { beforeEach, describe, expect, it } from "vitest";
import { setReportStore, type ReportStore } from "@/lib/reports/store";
import type { StoredReport } from "@/lib/reports/kinds";
import { summarizeReviews } from "@/lib/reviews/kinds";
import { readReviews, submitReview } from "@/lib/reviews/service";

function memory(): ReportStore {
  const lists = new Map<string, StoredReport[]>();
  return {
    kind: "memory",
    async append(trailId, report, ns = "reports") {
      const key = `${ns}:${trailId}`;
      lists.set(key, [report, ...(lists.get(key) ?? [])]);
    },
    async list(trailId, ns = "reports") {
      return [...(lists.get(`${ns}:${trailId}`) ?? [])];
    },
    async hit() {
      return 1;
    },
  };
}

const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

describe("summarising reviews", () => {
  it("counts one vote per person, newest wins", () => {
    const summary = summarizeReviews([
      { kind: "worth-it", at: at(1), who: "a" },
      { kind: "skip", at: at(9), who: "a" },
      { kind: "worth-it", at: at(2), who: "b" },
    ]);
    expect(summary.total).toBe(2);
    expect(summary.counts["worth-it"]).toBe(2);
    expect(summary.counts["skip"]).toBe(0);
  });

  it("does not expire the way condition reports do", () => {
    const summary = summarizeReviews([
      { kind: "worth-it", at: at(24 * 200), who: "a" },
      { kind: "worth-it", at: at(24 * 300), who: "b" },
    ]);
    expect(summary.total).toBe(2);
    expect(summary.worthItPct).toBe(100);
  });

  it("holds back a lone voice", () => {
    const one = summarizeReviews([{ kind: "skip", at: at(1), who: "a", note: "grim" }]);
    expect(one.worthItPct).toBeNull();
    expect(one.notes).toEqual([]);
    expect(one.headline).toMatch(/not enough yet/);

    const two = summarizeReviews([
      { kind: "skip", at: at(1), who: "a", note: "grim" },
      { kind: "skip", at: at(2), who: "b" },
    ]);
    expect(two.notes.map((n) => n.note)).toEqual(["grim"]);
  });

  it("says nothing at all with no reviews", () => {
    const summary = summarizeReviews([]);
    expect(summary.total).toBe(0);
    expect(summary.headline).toBeNull();
  });
});

describe("submitting a review", () => {
  beforeEach(() => setReportStore(memory()));

  it("stores and reads back a verdict", async () => {
    const result = await submitReview({
      trailId: "lake-blanche",
      verdict: "worth-it",
      note: "Go early, the lot fills",
      address: "1.2.3.4",
    });
    expect(result.ok).toBe(true);
    const summary = await readReviews("lake-blanche");
    expect(summary.counts["worth-it"]).toBe(1);
  });

  it("keeps reviews clear of condition reports", async () => {
    await submitReview({ trailId: "lake-blanche", verdict: "skip", note: null, address: "1.2.3.4" });
    const { readSummary } = await import("@/lib/reports/service");
    const conditions = await readSummary("lake-blanche");
    expect(conditions.confirmed).toEqual([]);
  });

  it("refuses an unknown place or verdict", async () => {
    const badPlace = await submitReview({
      trailId: "nope", verdict: "worth-it", note: null, address: "1.2.3.4",
    });
    expect(badPlace.ok).toBe(false);
    expect(badPlace.ok ? 0 : badPlace.status).toBe(400);

    const badVerdict = await submitReview({
      trailId: "lake-blanche", verdict: "five-stars", note: null, address: "1.2.3.4",
    });
    expect(badVerdict.ok).toBe(false);
    expect(badVerdict.ok ? 0 : badVerdict.status).toBe(400);
  });
});
