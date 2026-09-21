import { describe, expect, it } from "vitest";
import { scoreTrail, compareVerdicts, gradeFor, estimateHours } from "@/lib/scoring";
import {
  airQualityRule,
  precipitationRule,
  pressureRule,
  rockRule,
  surfaceRule,
  temperatureRule,
  waterFlowRule,
  waterTempRule,
  wildfireRule,
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

describe("imported climbing areas", () => {
  it("marks inferred rock types in the reason so the UI can disclose them", () => {
    const factor = rockRule({
      trail: trail({ rockType: "sandstone", rockTypeSource: "inferred" }),
      conditions: goodConditions({ hoursSincePrecip: 200 }),
      activity: "climb",
    });
    expect(factor.reason).toContain("inferred");
  });

  it("still fires the sandstone veto on an inferred rock type", () => {
    // The conservative error on the Colorado Plateau is telling someone to
    // wait, so uncertainty must not quietly disable the safety rule.
    const factor = rockRule({
      trail: trail({ rockType: "sandstone", rockTypeSource: "inferred" }),
      conditions: goodConditions({ hoursSincePrecip: 6 }),
      activity: "climb",
    });
    expect(factor.veto).toBe(true);
  });
});

describe("factor presentation", () => {
  it("carries the real reading in real units, not a percentage", () => {
    const verdict = scoreTrail(trail(), goodConditions({ tempMaxF: 62, tempMinF: 44 }), "hike");
    const temp = verdict.factors.find((f) => f.id === "temperature");

    expect(temp?.display).toBe("44–62 °F");
    // The 0-100 score stays available for comparison; it is just not the
    // number the panel leads with.
    expect(temp?.score).toBeDefined();
  });

  it("gives every scored factor a reading", () => {
    const verdict = scoreTrail(
      trail({ rockType: "granite" }),
      goodConditions({ hoursSincePrecip: 30 }),
      "climb",
    );
    for (const factor of verdict.factors) {
      if (factor.score !== undefined) expect(factor.display).toBeTruthy();
    }
  });

  it("orders factors by how much they matter for the activity", () => {
    const climbing = scoreTrail(
      trail({ rockType: "sandstone" }),
      goodConditions({ hoursSincePrecip: 200 }),
      "climb",
    );
    const riding = scoreTrail(trail(), goodConditions(), "mtb");

    // Rock condition dominates climbing; trail surface dominates riding.
    expect(climbing.factors[0]?.id).toBe("rock");
    expect(riding.factors[0]?.id).toBe("surface");
  });

  it("keeps the ordering identical regardless of the day's conditions", () => {
    // Several factors carry equal weight for hiking. Ties must break on a
    // fixed order rather than on score, or the panel reshuffles with the
    // weather and the reader loses the place they learned.
    const fine = scoreTrail(trail(), goodConditions(), "hike");
    const grim = scoreTrail(trail(), goodConditions({ tempMaxF: 99, usAqi: 180 }), "hike");
    expect(fine.factors.map((f) => f.id)).toEqual(grim.factors.map((f) => f.id));
  });
});

// ---------------------------------------------------------------------------
// Fishing
// ---------------------------------------------------------------------------

describe("water temperature rule", () => {
  it("vetoes above the temperature where released trout die", () => {
    const factor = waterTempRule({
      trail: trail(),
      conditions: goodConditions({ waterTempF: 70 }),
      activity: "fish",
    });
    expect(factor.veto).toBe(true);
    expect(factor.reason.toLowerCase()).toContain("release");
  });

  it("rates the feeding band highest", () => {
    const factor = waterTempRule({
      trail: trail(),
      conditions: goodConditions({ waterTempF: 56 }),
      activity: "fish",
    });
    expect(factor.score).toBe(100);
    expect(factor.veto).toBeFalsy();
  });

  it("marks cold water down without vetoing it", () => {
    const factor = waterTempRule({
      trail: trail(),
      conditions: goodConditions({ waterTempF: 38 }),
      activity: "fish",
    });
    expect(factor.score ?? 100).toBeLessThan(80);
    expect(factor.veto).toBeFalsy();
  });

  it("reports no data rather than guessing when no gauge is in range", () => {
    const factor = waterTempRule({
      trail: trail(),
      conditions: goodConditions({ waterTempF: undefined }),
      activity: "fish",
    });
    expect(factor.score).toBeUndefined();
    expect(factor.missingReason).toBeTruthy();
  });

  it("makes the warm-water veto decide the whole verdict", () => {
    const verdict = scoreTrail(trail(), goodConditions({ waterTempF: 71 }), "fish");
    expect(verdict.grade).toBe("unsafe");
  });
});

describe("flow and clarity rule", () => {
  it("reads recent rain as colour in the water", () => {
    const clear = waterFlowRule({
      trail: trail(),
      conditions: goodConditions({ streamflowCfs: 120, precipitationPrior72hIn: 0 }),
      activity: "fish",
    });
    const blown = waterFlowRule({
      trail: trail(),
      conditions: goodConditions({ streamflowCfs: 120, precipitationPrior72hIn: 0.9 }),
      activity: "fish",
    });
    expect(blown.score ?? 100).toBeLessThan(clear.score ?? 0);
    expect(blown.reason).toContain("coloured");
  });

  it("flags very low water", () => {
    const factor = waterFlowRule({
      trail: trail(),
      conditions: goodConditions({ streamflowCfs: 4, precipitationPrior72hIn: 0 }),
      activity: "fish",
    });
    expect(factor.reason).toContain("low flow");
  });
});

describe("barometric trend rule", () => {
  it("prefers falling pressure to rising", () => {
    const falling = pressureRule({
      trail: trail(),
      conditions: goodConditions({ pressureChangeHpa: -4 }),
      activity: "fish",
    });
    const rising = pressureRule({
      trail: trail(),
      conditions: goodConditions({ pressureChangeHpa: 6 }),
      activity: "fish",
    });
    expect(falling.score ?? 0).toBeGreaterThan(rising.score ?? 100);
    expect(falling.score).toBe(100);
  });
});

describe("fishing profile", () => {
  it("leads with water temperature, the factor carrying the veto", () => {
    const verdict = scoreTrail(
      trail(),
      goodConditions({ waterTempF: 55, streamflowCfs: 90, pressureChangeHpa: -2 }),
      "fish",
    );
    expect(verdict.factors[0]?.id).toBe("water_temp");
  });
});

// ---------------------------------------------------------------------------
// Readability fixes from use
// ---------------------------------------------------------------------------

describe("surface reading", () => {
  it("shows the condition, not a rain total to decode", () => {
    const dry = surfaceRule({ trail: trail(), conditions: goodConditions(), activity: "hike" });
    const muddy = surfaceRule({
      trail: trail({ surface: "clay", aspect: "N" }),
      conditions: goodConditions({ precipitationPrior72hIn: 0.8 }),
      activity: "hike",
    });
    expect(dry.display).toBe("dry");
    expect(muddy.display).toBe("muddy");
  });

  it("keeps the rain figure in the explanation, in plain units", () => {
    const factor = surfaceRule({
      trail: trail({ surface: "clay", aspect: "N" }),
      conditions: goodConditions({ precipitationPrior72hIn: 0.8 }),
      activity: "hike",
    });
    expect(factor.reason).toContain("0.80 in of rain over the last 3 days");
  });
});

describe("unit rendering", () => {
  it("never uses a bare double-quote as an inch mark", () => {
    // On screen, 0.41" reads as a stray quotation mark rather than inches.
    const wet = goodConditions({
      precipitationIn: 0.4,
      precipitationChancePct: 70,
      precipitationPrior72hIn: 0.9,
      snowDepthIn: 3,
    });
    const verdict = scoreTrail(trail({ surface: "clay" }), wet, "hike");
    for (const factor of verdict.factors) {
      expect(factor.display ?? "").not.toMatch(/\d"/);
      expect(factor.reason).not.toMatch(/\d"/);
    }
  });
});

describe("wildfire at range", () => {
  const fire = (distanceMi: number) => [{ name: "Test Ridge", distanceMi, acres: 4000 }];

  it("counts a fire 90 miles out, gently", () => {
    const factor = wildfireRule({
      trail: trail(),
      conditions: goodConditions({ wildfires: fire(90) }),
      activity: "hike",
    });
    expect(factor.score ?? 0).toBeGreaterThan(80);
    expect(factor.veto).toBeFalsy();
  });

  it("blames a fire in range when the air is actually bad", () => {
    const factor = wildfireRule({
      trail: trail(),
      conditions: goodConditions({ wildfires: fire(60), usAqi: 160 }),
      activity: "hike",
    });
    expect(factor.reason).toContain("smoke is likely what you are breathing");
  });

  it("says the air is clean when a distant fire is not reaching you", () => {
    const factor = wildfireRule({
      trail: trail(),
      conditions: goodConditions({ wildfires: fire(60), usAqi: 32 }),
      activity: "hike",
    });
    expect(factor.reason).toContain("air is clean for now");
  });

  it("still vetoes a fire on the doorstep", () => {
    const factor = wildfireRule({
      trail: trail(),
      conditions: goodConditions({ wildfires: fire(3) }),
      activity: "hike",
    });
    expect(factor.veto).toBe(true);
  });
});
