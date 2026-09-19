import { describe, expect, it } from "vitest";
import { coerceQuery, parseQuery } from "@/lib/ask/parse";
import {
  DEFAULT_NEARBY_RADIUS_MI,
  radiusFor,
  rankByProximity,
  templateNarrative,
} from "@/lib/ask/answer";
import { lowerFirst, scoreTrail } from "@/lib/scoring";
import { goodConditions, trail } from "./fixtures";
import type { Grade, TrailReport } from "@/lib/types";

// 2026-09-17 is a Thursday.
const TODAY = "2026-09-17";

describe("parseQuery", () => {
  it("picks the activity out of casual phrasing", () => {
    expect(parseQuery("where should I ride saturday", TODAY).activity).toBe("mtb");
    expect(parseQuery("good trail run tomorrow", TODAY).activity).toBe("trail_run");
    expect(parseQuery("climbing conditions friday", TODAY).activity).toBe("climb");
    expect(parseQuery("somewhere to hike", TODAY).activity).toBe("hike");
  });

  it("defaults to hiking when nothing indicates an activity", () => {
    expect(parseQuery("what about this weekend", TODAY).activity).toBe("hike");
  });

  it("resolves the day", () => {
    expect(parseQuery("anything good saturday?", TODAY).date).toBe("2026-09-19");
    expect(parseQuery("what about tomorrow", TODAY).date).toBe("2026-09-18");
  });

  it("falls back to today when no day is named", () => {
    expect(parseQuery("somewhere shady", TODAY).date).toBe(TODAY);
  });

  it("resolves a named origin to coordinates", () => {
    const query = parseQuery("where should I hike saturday near salt lake?", TODAY);
    expect(query.near).toBe("Salt Lake City");
    expect(query.origin?.lat).toBeCloseTo(40.76, 1);
  });

  it("converts a drive time into a radius", () => {
    const query = parseQuery("hiking within 2 hours of slc", TODAY);
    expect(query.withinMi).toBe(90);
  });

  it("reads an explicit mile radius", () => {
    expect(parseQuery("riding within 30 miles of provo", TODAY).withinMi).toBe(30);
  });

  it("reads route-length and gain caps", () => {
    const query = parseQuery("trail run under 5 miles with less than 1200 ft", TODAY);
    expect(query.maxDistanceMi).toBe(5);
    expect(query.maxGainFt).toBe(1200);
  });

  it("explains how it read the question", () => {
    const query = parseQuery("where should I ride saturday near park city?", TODAY);
    expect(query.interpretation).toContain("mountain biking");
    expect(query.interpretation).toContain("Park City");
    expect(query.parsedBy).toBe("rules");
  });
});

describe("coerceQuery", () => {
  const fallback = parseQuery("hike today", TODAY);

  it("accepts a well-formed model response", () => {
    const query = coerceQuery(
      { activity: "mtb", date: "2026-09-20", near: "Moab", withinMi: 50, interpretation: "riding near Moab" },
      TODAY,
      fallback,
    );
    expect(query.activity).toBe("mtb");
    expect(query.date).toBe("2026-09-20");
    expect(query.origin?.label).toBe("Moab");
    expect(query.parsedBy).toBe("llm");
  });

  it("rejects a bad activity and keeps the deterministic value", () => {
    const query = coerceQuery({ activity: "skydiving" }, TODAY, fallback);
    expect(query.activity).toBe(fallback.activity);
  });

  it("rejects a malformed date", () => {
    expect(coerceQuery({ date: "next tuesday" }, TODAY, fallback).date).toBe(fallback.date);
  });

  it("falls back entirely on junk input", () => {
    expect(coerceQuery(null, TODAY, fallback).activity).toBe(fallback.activity);
    expect(coerceQuery("not an object", TODAY, fallback).date).toBe(fallback.date);
  });
});

function reportFor(id: string, name: string, conditions = goodConditions()): TrailReport {
  const t = trail({ id, name });
  return { trail: t, conditions, verdict: scoreTrail(t, conditions, "hike") };
}

describe("templateNarrative", () => {
  const query = parseQuery("where should I hike saturday", TODAY);

  it("names the top pick and the runner-up", () => {
    const reports = [
      reportFor("a", "First Summit"),
      reportFor("b", "Second Summit", goodConditions({ tempMaxF: 82 })),
    ];
    const narrative = templateNarrative(query, reports, TODAY);
    expect(narrative).toContain("First Summit");
    expect(narrative).toContain("Second Summit");
    expect(narrative).toContain("Saturday");
  });

  it("says so when nothing matches", () => {
    expect(templateNarrative(query, [], TODAY)).toContain("Nothing in the dataset");
  });

  it("leads with the warning when the best option is still a no-go", () => {
    const t = trail({ id: "x", name: "Windy Ridge", exposed: true });
    const conditions = goodConditions({ windGustMph: 60 });
    const reports: TrailReport[] = [
      { trail: t, conditions, verdict: scoreTrail(t, conditions, "hike") },
    ];
    const narrative = templateNarrative(query, reports, TODAY);
    expect(narrative.toLowerCase()).toContain("don't go");
    expect(narrative).toContain("Windy Ridge");
  });
});

// ---------------------------------------------------------------------------
// Proximity handling
// ---------------------------------------------------------------------------

function fakeReport(
  id: string,
  name: string,
  lat: number,
  lon: number,
  score: number,
  grade: Grade = "prime",
): TrailReport {
  const t = trail({ id, name, lat, lon });
  const conditions = goodConditions();
  return {
    trail: t,
    conditions,
    verdict: {
      trailId: id,
      activity: "mtb",
      date: conditions.date,
      score,
      grade,
      headline: `${grade} test headline`,
      factors: [],
      sources: [],
      confidence: 1,
    },
  };
}

const PARK_CITY = { lat: 40.6461, lon: -111.498, label: "Park City" };

describe("radiusFor", () => {
  it("honours an explicit radius", () => {
    const query = { ...parseQuery("riding within 20 miles of provo", TODAY) };
    expect(radiusFor(query)).toBe(20);
  });

  it("applies a default radius when a place is named without one", () => {
    const query = parseQuery("where should I ride near park city", TODAY);
    expect(query.origin).toBeDefined();
    expect(radiusFor(query)).toBe(DEFAULT_NEARBY_RADIUS_MI);
  });

  it("applies no radius when no place is named", () => {
    expect(radiusFor(parseQuery("where should I ride saturday", TODAY))).toBeUndefined();
  });
});

describe("rankByProximity", () => {
  it("prefers the closer trail when conditions are effectively tied", () => {
    const far = fakeReport("far", "Far Trail", 40.7686, -111.8226, 95);
    const near = fakeReport("near", "Near Trail", 40.66, -111.59, 94);

    const ranked = rankByProximity([far, near], PARK_CITY);
    expect(ranked[0]?.trail.name).toBe("Near Trail");
  });

  it("does not let proximity override a real difference in conditions", () => {
    const far = fakeReport("far", "Far Trail", 40.7686, -111.8226, 95);
    const near = fakeReport("near", "Near Trail", 40.66, -111.59, 70);

    const ranked = rankByProximity([far, near], PARK_CITY);
    expect(ranked[0]?.trail.name).toBe("Far Trail");
  });

  it("keeps a no-go last however close it is", () => {
    const closeButUnsafe = fakeReport("x", "Close No-Go", 40.646, -111.499, 96, "unsafe");
    const fine = fakeReport("y", "Fine Trail", 40.7686, -111.8226, 80);

    const ranked = rankByProximity([closeButUnsafe, fine], PARK_CITY);
    expect(ranked[0]?.trail.name).toBe("Fine Trail");
    expect(ranked[1]?.trail.name).toBe("Close No-Go");
  });

  it("leaves order alone when no origin was given", () => {
    const a = fakeReport("a", "A", 40.1, -111.1, 90);
    const b = fakeReport("b", "B", 41.9, -112.9, 91);
    expect(rankByProximity([a, b], undefined).map((r) => r.trail.id)).toEqual(["a", "b"]);
  });
});

describe("narrative polish", () => {
  it("states the distance from the named origin", () => {
    const query = parseQuery("where should I ride near park city", TODAY);
    const reports = [fakeReport("a", "Crest Trail", 40.66, -111.59, 92)];
    expect(templateNarrative(query, reports, TODAY)).toMatch(/\d+ mi from Park City/);
  });

  it("does not mangle an abbreviation when splicing a reason mid-sentence", () => {
    expect(lowerFirst("AQI 142 is unhealthy")).toBe("AQI 142 is unhealthy");
    expect(lowerFirst("Dry and firm dirt")).toBe("dry and firm dirt");
    expect(lowerFirst("12.3 h of daylight")).toBe("12.3 h of daylight");
  });
});
