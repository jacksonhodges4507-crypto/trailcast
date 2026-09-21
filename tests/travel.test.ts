import { describe, expect, it } from "vitest";
import { coarsen, drivePenalty, estimateTravel, FREE_MINUTES } from "@/lib/travel";
import { parseOrigin } from "@/lib/origin";
import { formatDrive } from "@/lib/format";
import { radiusFor, rankByProximity, templateNarrative } from "@/lib/ask/answer";
import { parseQuery } from "@/lib/ask/parse";
import { goodConditions, trail } from "./fixtures";
import type { AskQuery, TrailReport, Travel } from "@/lib/types";

const TODAY = "2026-09-17";
const PROVO = { lat: 40.2338, lon: -111.6585 };

describe("location privacy", () => {
  it("coarsens coordinates to about a kilometre", () => {
    expect(coarsen({ lat: 40.233812, lon: -111.658534 })).toEqual({ lat: 40.23, lon: -111.66 });
  });

  it("rejects out-of-range and non-numeric origins instead of forwarding them", () => {
    expect(parseOrigin("91", "-111")).toBeUndefined();
    expect(parseOrigin("40", "-181")).toBeUndefined();
    expect(parseOrigin("abc", "-111")).toBeUndefined();
    expect(parseOrigin(undefined, undefined)).toBeUndefined();
    expect(parseOrigin("NaN", "1")).toBeUndefined();
  });

  it("accepts valid input, coarsened before use", () => {
    expect(parseOrigin("40.23381", "-111.65853")).toEqual({ lat: 40.23, lon: -111.66 });
    expect(parseOrigin(40.23381, -111.65853)).toEqual({ lat: 40.23, lon: -111.66 });
  });
});

describe("travel estimates", () => {
  it("labels the straight-line fallback as an estimate", () => {
    const moab = { lat: 38.5733, lon: -109.5498 };
    const t = estimateTravel(PROVO, moab);
    expect(t.source).toBe("estimate");
    // Provo to Moab is roughly a four-hour drive; the estimate should be
    // in the right region, not exact.
    expect(t.minutes).toBeGreaterThan(150);
    expect(t.minutes).toBeLessThan(330);
  });

  it("formats drive times the way people say them", () => {
    expect(formatDrive(42)).toBe("42 min");
    expect(formatDrive(60)).toBe("1 h");
    expect(formatDrive(145)).toBe("2 h 25 m");
  });
});

describe("drive penalty", () => {
  it("is free for the first half hour", () => {
    expect(drivePenalty(0)).toBe(0);
    expect(drivePenalty(FREE_MINUTES)).toBe(0);
  });

  it("costs six points per hour after that", () => {
    expect(drivePenalty(FREE_MINUTES + 60)).toBeCloseTo(6, 6);
    expect(drivePenalty(FREE_MINUTES + 120)).toBeCloseTo(12, 6);
  });
});

function located(
  id: string,
  name: string,
  score: number,
  minutes: number,
  grade: TrailReport["verdict"]["grade"] = "prime",
): TrailReport {
  const t = trail({ id, name });
  const conditions = goodConditions();
  const travel: Travel = { minutes, miles: Math.round(minutes * 0.7), source: "osrm" };
  return {
    trail: t,
    conditions,
    travel,
    verdict: {
      trailId: id,
      activity: "climb",
      date: conditions.date,
      score,
      grade,
      headline: `${grade} test`,
      factors: [],
      sources: [],
      confidence: 1,
    },
  };
}

describe("ranking by whether it is worth the drive", () => {
  it("prefers a slightly worse crag that is much closer", () => {
    const far = located("far", "Far Crag", 96, 190); // 3 h 10 m
    const near = located("near", "Near Crag", 91, 15);
    const ranked = rankByProximity([far, near], PROVO);
    expect(ranked[0]?.trail.name).toBe("Near Crag");
  });

  it("still picks the far crag when it is much better", () => {
    const far = located("far", "Far Crag", 97, 120);
    const near = located("near", "Near Crag", 62, 15);
    const ranked = rankByProximity([far, near], PROVO);
    expect(ranked[0]?.trail.name).toBe("Far Crag");
  });

  it("never lets a short drive rescue a no-go", () => {
    const unsafe = located("x", "Doorstep No-Go", 95, 5, "unsafe");
    const fine = located("y", "Fine Crag", 80, 90);
    const ranked = rankByProximity([unsafe, fine], PROVO);
    expect(ranked[0]?.trail.name).toBe("Fine Crag");
  });
});

describe("device location and radius", () => {
  it("does not filter by radius just because a location was shared", () => {
    const query: AskQuery = {
      ...parseQuery("where should I climb saturday", TODAY),
      origin: { ...PROVO, label: "your location" },
      originSource: "device",
    };
    expect(radiusFor(query)).toBeUndefined();
  });

  it("still applies the radius for a named place", () => {
    const query = parseQuery("where should I climb near moab", TODAY);
    expect(radiusFor(query)).toBe(50);
  });
});

describe("trade-off narrative", () => {
  it("says what the extra drive buys", () => {
    const query: AskQuery = {
      ...parseQuery("where should I climb saturday", TODAY),
      origin: { ...PROVO, label: "your location" },
      originSource: "device",
    };
    const top = located("far", "Far Crag", 97, 150);
    const runnerUp = located("near", "Near Crag", 88, 20);
    const narrative = templateNarrative(query, [top, runnerUp], TODAY);

    expect(narrative).toContain("2 h 30 m drive");
    expect(narrative).toContain("9 points better than Near Crag");
    expect(narrative).toContain("further each way");
  });

  it("counts a shorter drive in the pick's favour", () => {
    const query: AskQuery = {
      ...parseQuery("where should I climb saturday", TODAY),
      origin: { ...PROVO, label: "your location" },
      originSource: "device",
    };
    const top = located("near", "Near Crag", 95, 20);
    const runnerUp = located("far", "Far Crag", 93, 140);
    const narrative = templateNarrative(query, [top, runnerUp], TODAY);
    expect(narrative).toContain("beats Far Crag");
    expect(narrative).toContain("on the drive");
  });
});

describe("trade-off wording scales with the cost", () => {
  const query: AskQuery = {
    ...parseQuery("where should I climb saturday", TODAY),
    origin: { ...PROVO, label: "your location" },
    originSource: "device",
  };

  it("treats a short extra drive as an easy call", () => {
    const narrative = templateNarrative(
      query,
      [located("a", "Close Pick", 90, 31), located("b", "Closer Still", 84, 11)],
      TODAY,
    );
    expect(narrative).toContain("easy trade");
    expect(narrative).not.toContain("short on time");
  });

  it("names a long extra drive as a genuine trade-off", () => {
    const narrative = templateNarrative(
      query,
      [located("a", "Far Pick", 94, 160), located("b", "Near One", 90, 20)],
      TODAY,
    );
    expect(narrative).toContain("short on time");
  });
});
