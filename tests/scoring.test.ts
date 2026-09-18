import { describe, expect, it } from "vitest";
import { scoreTrail, compareVerdicts, gradeFor, estimateHours } from "@/lib/scoring";
import {
  airQualityRule,
  precipitationRule,
  rockRule,
  surfaceRule,
  temperatureRule,
  windRule,
} from "@/lib/scoring/rules";
import { goodConditions, trail } from "./fixtures";
import type { Trail } from "@/lib/types";

describe("scoreTrail on a clear autumn day", () => {
  const verdict = scoreTrail(trail(), goodConditions(), "hike");

  it("grades it prime", () => {
    expect(verdict.grade).toBe("prime");
    expect(verdict.score).toBeGreaterThanOrEqual(90);
  });

  it("reports full confidence when every input is present", () => {
    expect(verdict.confidence).toBe(1);
  });

  it("scores every factor the activity profile asked for", () => {
    expect(verdict.factors).toHaveLength(7);
    for (const factor of verdict.factors) {
      expect(factor.score).toBeDefined();
      expect(factor.missingReason).toBeUndefined();
    }
  });

  it("normalises factor weights to one", () => {
    const total = verdict.factors.reduce((sum, f) => sum + f.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("cites at least one source", () => {
    expect(verdict.sources.length).toBeGreaterThan(0);
  });
});

describe("missing inputs", () => {
  const verdict = scoreTrail(
    trail(),
    goodConditions({ usAqi: undefined, pm25: undefined }),
    "hike",
  );

  it("lowers confidence instead of the score", () => {
    expect(verdict.confidence).toBeLessThan(1);
    expect(verdict.confidence).toBeGreaterThan(0.8);
    // A missing input must not drag the composite down.
    expect(verdict.grade).toBe("prime");
  });

  it("marks the unscored factor rather than guessing it", () => {
    const air = verdict.factors.find((f) => f.id === "air_quality");
    expect(air?.score).toBeUndefined();
    expect(air?.missingReason).toBeTruthy();
  });
});

describe("vetoes", () => {
  it("forces a no-go when heavy rain lands on exposed terrain", () => {
    const verdict = scoreTrail(
      trail({ exposed: true }),
      goodConditions({ precipitationIn: 1.2, precipitationChancePct: 90 }),
      "hike",
    );
    expect(verdict.grade).toBe("unsafe");
    expect(verdict.headline.toLowerCase()).toContain("flash flood");
  });

  it("forces a no-go on high gusts over exposed ground", () => {
    const verdict = scoreTrail(
      trail({ exposed: true }),
      goodConditions({ windMph: 34, windGustMph: 52 }),
      "hike",
    );
    expect(verdict.grade).toBe("unsafe");
  });

  it("beats a high average — good weather cannot average a veto away", () => {
    const conditions = goodConditions({ windMph: 34, windGustMph: 52 });
    const verdict = scoreTrail(trail({ exposed: true }), conditions, "hike");
    // Every other factor is near perfect, so the composite stays high...
    expect(verdict.score ?? 0).toBeGreaterThan(60);
    // ...and the grade is still a no-go.
    expect(verdict.grade).toBe("unsafe");
  });

  it("does not fire on the same wind in sheltered terrain", () => {
    const verdict = scoreTrail(
      trail({ exposed: false }),
      goodConditions({ windMph: 34, windGustMph: 52 }),
      "hike",
    );
    expect(verdict.grade).not.toBe("unsafe");
  });
});

describe("temperature rule", () => {
  it("is perfect in the comfort band", () => {
    const factor = temperatureRule({
      trail: trail(),
      conditions: goodConditions({ tempMaxF: 62 }),
      activity: "hike",
    });
    expect(factor.score).toBe(100);
  });

  it("penalises heat harder on an unshaded route", () => {
    const hot = goodConditions({ tempMaxF: 84 });
    const shaded = temperatureRule({ trail: trail({ exposed: false }), conditions: hot, activity: "hike" });
    const open = temperatureRule({ trail: trail({ exposed: true }), conditions: hot, activity: "hike" });
    expect(open.score ?? 0).toBeLessThan(shaded.score ?? 0);
  });

  it("penalises cold less steeply than heat", () => {
    const cold = temperatureRule({ trail: trail(), conditions: goodConditions({ tempMaxF: 20 }), activity: "hike" });
    const hot = temperatureRule({ trail: trail(), conditions: goodConditions({ tempMaxF: 88 }), activity: "hike" });
    expect(cold.score ?? 0).toBeGreaterThan(hot.score ?? 0);
  });
});

describe("precipitation rule", () => {
  it("treats wet rock as worse for climbers than for hikers", () => {
    const wet = goodConditions({ precipitationIn: 0.2, precipitationChancePct: 60 });
    const hiking = precipitationRule({ trail: trail(), conditions: wet, activity: "hike" });
    const climbing = precipitationRule({ trail: trail(), conditions: wet, activity: "climb" });
    expect(climbing.score ?? 0).toBeLessThan(hiking.score ?? 0);
  });
});

describe("wind rule", () => {
  it("derives a gust estimate when only sustained wind is forecast", () => {
    const factor = windRule({
      trail: trail(),
      conditions: goodConditions({ windGustMph: undefined, windMph: 25 }),
      activity: "hike",
    });
    expect(factor.score).toBeDefined();
    expect(factor.score ?? 100).toBeLessThan(100);
  });
});

describe("air quality rule", () => {
  it("follows the US AQI categories", () => {
    const clean = airQualityRule({ trail: trail(), conditions: goodConditions({ usAqi: 30 }), activity: "hike" });
    const smoky = airQualityRule({ trail: trail(), conditions: goodConditions({ usAqi: 175 }), activity: "hike" });
    expect(clean.score ?? 0).toBeGreaterThan(90);
    expect(smoky.score ?? 100).toBeLessThan(40);
  });
});

describe("surface rule", () => {
  const wet = goodConditions({ precipitationPrior72hIn: 0.8 });

  it("punishes north-facing clay far more than south-facing rock", () => {
    const clay = surfaceRule({
      trail: trail({ surface: "clay", aspect: "N" }),
      conditions: wet,
      activity: "hike",
    });
    const rock = surfaceRule({
      trail: trail({ surface: "rock", aspect: "S" }),
      conditions: wet,
      activity: "hike",
    });
    expect(clay.score ?? 100).toBeLessThan(rock.score ?? 0);
  });

  it("adds a riding-specific penalty that hiking does not get", () => {
    const hiking = surfaceRule({ trail: trail(), conditions: wet, activity: "hike" });
    const riding = surfaceRule({ trail: trail(), conditions: wet, activity: "mtb" });
    expect(riding.score ?? 0).toBeLessThan(hiking.score ?? 0);
    expect(riding.reason).toContain("rut");
  });

  it("flags high water at unbridged crossings", () => {
    const factor = surfaceRule({
      trail: trail({ waterCrossings: 2 }),
      conditions: wet,
      activity: "hike",
    });
    expect(factor.reason).toContain("crossings");
  });
});

describe("activity profiles", () => {
  it("makes surface matter more to a rider than to a hiker", () => {
    const muddy = goodConditions({ precipitationPrior72hIn: 0.9 });
    const riding = scoreTrail(trail({ surface: "clay" }), muddy, "mtb");
    const hiking = scoreTrail(trail({ surface: "clay" }), muddy, "hike");
    expect(riding.score ?? 0).toBeLessThan(hiking.score ?? 0);
  });

  it("makes heat matter more to a runner than to a hiker", () => {
    const hot = goodConditions({ tempMaxF: 90 });
    const running = scoreTrail(trail(), hot, "trail_run");
    const hiking = scoreTrail(trail(), hot, "hike");
    expect(running.score ?? 0).toBeLessThan(hiking.score ?? 0);
  });
});

describe("estimateHours", () => {
  it("scales with distance and climbing", () => {
    const short = estimateHours(trail({ distanceMi: 3, gainFt: 500 }), "hike");
    const long = estimateHours(trail({ distanceMi: 14, gainFt: 4500 }), "hike");
    expect(long).toBeGreaterThan(short * 2);
  });

  it("moves a runner through the same route faster than a hiker", () => {
    const route = trail({ distanceMi: 10, gainFt: 2000 });
    expect(estimateHours(route, "trail_run")).toBeLessThan(estimateHours(route, "hike"));
  });
});

describe("grade boundaries", () => {
  it("maps scores onto the documented bands", () => {
    expect(gradeFor(95)).toBe("prime");
    expect(gradeFor(85)).toBe("prime");
    expect(gradeFor(84)).toBe("good");
    expect(gradeFor(70)).toBe("good");
    expect(gradeFor(69)).toBe("marginal");
    expect(gradeFor(50)).toBe("marginal");
    expect(gradeFor(49)).toBe("poor");
  });
});

describe("compareVerdicts", () => {
  it("sorts higher scores first and vetoed trails last", () => {
    const great = scoreTrail(trail({ id: "a" }), goodConditions(), "hike");
    const poor = scoreTrail(trail({ id: "b" }), goodConditions({ tempMaxF: 99 }), "hike");
    const vetoed = scoreTrail(
      trail({ id: "c", exposed: true }),
      goodConditions({ windGustMph: 60 }),
      "hike",
    );

    const sorted = [vetoed, poor, great].sort(compareVerdicts);
    expect(sorted[0]?.trailId).toBe("a");
    expect(sorted[2]?.trailId).toBe("c");
  });
});

describe("headline selection", () => {
  it("does not lead with the absence of a hazard", () => {
    // Every factor is excellent, including wildfire at a perfect 100.
    const verdict = scoreTrail(trail(), goodConditions(), "hike");
    expect(verdict.grade).toBe("prime");
    expect(verdict.headline).not.toContain("no active fire perimeters");
  });

  it("still reports a fire when there is one", () => {
    const conditions = goodConditions({
      wildfires: [{ name: "Bald Mountain", distanceMi: 3.2, acres: 900 }],
    });
    const verdict = scoreTrail(trail(), conditions, "hike");
    expect(verdict.grade).toBe("unsafe");
    expect(verdict.headline).toContain("Bald Mountain");
  });

  it("leads a poor day with whatever dragged it down", () => {
    const verdict = scoreTrail(
      trail(),
      goodConditions({ tempMaxF: 103, usAqi: 30 }),
      "hike",
    );
    expect(verdict.headline.toLowerCase()).toContain("heat");
  });
});

// ---------------------------------------------------------------------------
// Rock condition (climbing)
// ---------------------------------------------------------------------------

describe("rock rule", () => {
  const crag = (rockType: Trail["rockType"], extra: Partial<Trail> = {}): Trail =>
    trail({ rockType, surface: "rock", aspect: "S", exposed: true, ...extra });

  it("vetoes sandstone within the Access Fund's 48-hour window", () => {
    const factor = rockRule({
      trail: crag("sandstone"),
      conditions: goodConditions({ hoursSincePrecip: 12 }),
      activity: "climb",
    });
    expect(factor.veto).toBe(true);
    expect(factor.reason).toContain("75%");
  });

  it("clears granite at the same 12 hours", () => {
    const factor = rockRule({
      trail: crag("granite"),
      conditions: goodConditions({ hoursSincePrecip: 12 }),
      activity: "climb",
    });
    expect(factor.veto).toBeFalsy();
    expect(factor.score ?? 0).toBeGreaterThan(50);
  });

  it("makes rock type decide the verdict, not the weather alone", () => {
    const conditions = goodConditions({ hoursSincePrecip: 24 });
    const sandstone = scoreTrail(crag("sandstone"), conditions, "climb");
    const granite = scoreTrail(crag("granite"), conditions, "climb");

    expect(sandstone.grade).toBe("unsafe");
    expect(granite.grade).not.toBe("unsafe");
  });

  it("gives shaded north-facing rock longer to dry", () => {
    const conditions = goodConditions({ hoursSincePrecip: 10 });
    const sunny = rockRule({
      trail: crag("limestone", { aspect: "S", exposed: true }),
      conditions,
      activity: "climb",
    });
    const shaded = rockRule({
      trail: crag("limestone", { aspect: "N", exposed: false }),
      conditions,
      activity: "climb",
    });

    expect(sunny.veto).toBeFalsy();
    expect(shaded.veto).toBe(true);
  });

  it("treats a long dry spell as good news, not missing data", () => {
    const factor = rockRule({
      trail: crag("sandstone"),
      conditions: goodConditions({ hoursSincePrecip: undefined }),
      activity: "climb",
    });
    expect(factor.score).toBe(100);
    expect(factor.missingReason).toBeUndefined();
  });

  it("ends the question when rain is forecast for the day itself", () => {
    const factor = rockRule({
      trail: crag("sandstone"),
      conditions: goodConditions({ precipitationIn: 0.2, hoursSincePrecip: 200 }),
      activity: "climb",
    });
    expect(factor.score).toBe(0);
    expect(factor.veto).toBe(true);
  });

  it("reports no data for an area with no rock type recorded", () => {
    const factor = rockRule({
      trail: trail({ rockType: undefined }),
      conditions: goodConditions(),
      activity: "climb",
    });
    expect(factor.score).toBeUndefined();
    expect(factor.missingReason).toBeTruthy();
  });
});

describe("activity temperature bands", () => {
  it("counts 66 F as perfect for hiking and already warm for climbing", () => {
    const conditions = goodConditions({ tempMaxF: 66 });
    const hiking = temperatureRule({ trail: trail(), conditions, activity: "hike" });
    const climbing = temperatureRule({ trail: trail(), conditions, activity: "climb" });

    expect(hiking.score).toBe(100);
    expect(climbing.score ?? 100).toBeLessThan(90);
  });

  it("counts a cold 40 F day as prime for climbing friction", () => {
    const conditions = goodConditions({ tempMaxF: 40 });
    const climbing = temperatureRule({ trail: trail(), conditions, activity: "climb" });
    expect(climbing.score).toBe(100);
  });
});
