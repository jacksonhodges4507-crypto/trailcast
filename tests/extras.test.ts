import { describe, expect, it } from "vitest";
import { TRAILS, getTrail } from "@/lib/trails";
import { accessSentence, dogSentence } from "@/lib/dogs";
import { foliageFor, isFoliageSeason, peakDayOfYear } from "@/lib/season/foliage";
import { summitFor } from "@/lib/summit";
import { quickStats } from "@/lib/format";
import { parseQuery } from "@/lib/ask/parse";
import { ask } from "@/lib/ask/answer";
import { quickStats } from "@/lib/format";

describe("dogs", () => {
  it("bans them in the Salt Lake watershed and allows them one canyon over", () => {
    expect(getTrail("lake-blanche")?.dogs).toBe("no");
    expect(getTrail("red-pine-lake")?.dogs).toBe("no");
    expect(getTrail("mount-olympus")?.dogs).toBe("leash");
  });

  it("bans them on national park trails", () => {
    expect(getTrail("angels-landing")?.dogs).toBe("no");
    expect(getTrail("delicate-arch")?.dogs).toBe("no");
  });

  it("cites the rule rather than asserting one", () => {
    expect(dogSentence(getTrail("lake-blanche")!)).toMatch(/watershed/i);
    const unchecked = TRAILS.find((t) => t.dogs === undefined)!;
    expect(dogSentence(unchecked)).toMatch(/Nobody has checked/);
  });

  it("shows up as a stat", () => {
    const labels = quickStats({
      trail: { ...getTrail("lake-blanche")!, distanceMi: 7 },
      conditions: {},
      verdict: { activity: "hike" },
    }).map((s) => s.label);
    expect(labels).toContain("Dogs");
  });
});

describe("wheelchair access", () => {
  it("says plainly when it hasn't been checked", () => {
    const unchecked = TRAILS.find((t) => t.accessible === undefined)!;
    expect(accessSentence(unchecked)).toMatch(/hasn't been checked/);
  });

  it("separates paved from accessible", () => {
    const donut = getTrail("donut-falls")!;
    expect(donut.paved).toBe(false);
    expect(donut.accessible).toBe("partly");
    expect(accessSentence(donut)).toMatch(/Partly accessible/);
  });
});

describe("fall color", () => {
  it("peaks later as you drop", () => {
    expect(peakDayOfYear(9500)).toBeLessThan(peakDayOfYear(7000));
  });

  it("calls peak near the estimated date", () => {
    const high = { ...getTrail("lake-blanche")!, elevationFt: 9500 };
    expect(foliageFor(high, "2026-09-18")?.status).toBe("peak");
    expect(foliageFor(high, "2026-08-01")?.status).toBe("too-early");
  });

  it("says nothing at all about color in the desert", () => {
    // Not a "no color here" note -- nothing. The panel hides the section,
    // because a Fall color heading that only reports its own absence is how
    // the page used to look lost in southern Utah.
    const desert = { ...getTrail("delicate-arch")!, elevationFt: 4800 };
    expect(foliageFor(desert, "2026-10-01")).toBeNull();
  });

  it("only shows in the fall", () => {
    expect(isFoliageSeason("2026-10-01")).toBe(true);
    expect(isFoliageSeason("2026-06-01")).toBe(false);
  });

  it("is never part of a conditions score", () => {
    const trail = getTrail("lake-blanche")!;
    expect(foliageFor(trail, "2026-09-20")).not.toBeNull();
    // Nothing on the trail record changes with the date.
    expect(trail.gainFt).toBe(getTrail("lake-blanche")!.gainFt);
  });
});

describe("Scout understands dogs and leaves", () => {
  it("reads the question", () => {
    const dog = parseQuery("a hike saturday where i can bring my dog", "2026-09-22");
    expect(dog.needsDogFriendly).toBe(true);
    expect(dog.interpretation).toMatch(/dogs are allowed/);

    const leaves = parseQuery("where are the fall colors", "2026-09-22");
    expect(leaves.wantsFallColor).toBe(true);
  });

  it("does not offer a watershed canyon to someone with a dog", async () => {
    const answer = await ask({
      question: "somewhere to hike with my dog",
      allowLlm: false,
      today: "2026-09-22",
    });
    for (const report of answer.results) expect(report.trail.dogs).not.toBe("no");
  });
});

describe("summit conditions", () => {
  const profile = {
    levels: [
      { hPa: 850, heightFt: 5000, tempF: 72, windMph: 4 },
      { hPa: 700, heightFt: 10400, tempF: 48, windMph: 22 },
      { hPa: 600, heightFt: 14500, tempF: 29, windMph: 30 },
    ],
  };
  const base = (over = {}) => ({
    date: "2026-09-25",
    timezone: "America/Denver",
    tempMaxF: 70,
    tempMinF: 45,
    windMph: 6,
    profile,
    refs: {},
    ...over,
  });
  const trail = (elevationFt: number, gainFt: number) => ({
    ...getTrail("lake-blanche")!,
    elevationFt,
    gainFt,
  });

  it("shifts the surface forecast by the difference between two heights", () => {
    // 6,000 ft -> 10,000 ft. The profile falls 24F over 5,400 ft, so 4,000 ft
    // of climb is about 17.8F. The answer must be anchored on the surface
    // high of 70, NOT on the profile's own 60-ish value at that height:
    // free-air and 2m temperatures disagree by up to 8F over a day.
    const summit = summitFor(trail(6000, 4000), base())!;
    expect(summit.elevationFt).toBe(10000);
    expect(summit.tempMaxF).toBeCloseTo(70 - 17.8, 0);
    expect(summit.tempMinF).toBeCloseTo(45 - 17.8, 0);
    expect(summit.coolerByF).toBeCloseTo(17.8, 0);
    expect(summit.inverted).toBe(false);
  });

  it("reads an inversion the right way round", () => {
    // Utah in winter: the valley is the cold end. A fixed lapse rate would
    // report the peak as colder and be wrong by the whole spread.
    const inverted = {
      levels: [
        { hPa: 850, heightFt: 5000, tempF: 20, windMph: 3 },
        { hPa: 700, heightFt: 10400, tempF: 42, windMph: 18 },
      ],
    };
    const summit = summitFor(trail(5000, 4000), base({ profile: inverted, tempMaxF: 25 }))!;
    expect(summit.inverted).toBe(true);
    expect(summit.tempMaxF!).toBeGreaterThan(25);
  });

  it("never reports the ridge as calmer than the canyon", () => {
    const sheltered = {
      levels: [
        { hPa: 850, heightFt: 5000, tempF: 60, windMph: 1 },
        { hPa: 700, heightFt: 10400, tempF: 40, windMph: 2 },
      ],
    };
    // This is the failure the whole design is built around: asked directly,
    // the model puts less wind on the summit than the trailhead.
    const summit = summitFor(trail(6000, 4000), base({ profile: sheltered, windMph: 12 }))!;
    expect(summit.windMph).toBeGreaterThanOrEqual(12);
  });

  it("carries ridge wind through when it is the stronger of the two", () => {
    const summit = summitFor(trail(6000, 4000), base())!;
    expect(summit.windMph).toBeGreaterThan(15);
  });

  it("says nothing about a summit that isn't one", () => {
    expect(summitFor(trail(4500, 120), base())).toBeNull();
    expect(summitFor(trail(0, 4000), base())).toBeNull();
  });

  it("needs a profile to say anything", () => {
    expect(summitFor(trail(6000, 4000), base({ profile: undefined }))).toBeNull();
  });
});

describe("stat tiles only claim what is known", () => {
  const conditions = {
    date: "2026-09-25",
    timezone: "America/Denver",
    tempMaxF: 70,
    windMph: 6,
    precipitationChancePct: 10,
    refs: {},
  };

  it("drops the Dogs tile when nobody has recorded a rule", () => {
    const trail = { ...getTrail("lake-blanche")!, dogs: undefined };
    const labels = quickStats({
      trail,
      conditions,
      verdict: { activity: "hike", date: "2026-09-25" },
    } as never).map((s) => s.label);
    expect(labels).not.toContain("Dogs");
  });

  it("keeps it when there is one", () => {
    const trail = { ...getTrail("lake-blanche")!, dogs: "no" as const };
    const tiles = quickStats({
      trail,
      conditions,
      verdict: { activity: "hike", date: "2026-09-25" },
    } as never);
    expect(tiles.find((s) => s.label === "Dogs")?.value).toBe("No");
  });
});
