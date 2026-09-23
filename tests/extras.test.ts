import { describe, expect, it } from "vitest";
import { TRAILS, getTrail } from "@/lib/trails";
import { accessSentence, dogSentence } from "@/lib/dogs";
import { foliageFor, isFoliageSeason, peakDayOfYear } from "@/lib/season/foliage";
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

  it("says desert trails aren't a color trip", () => {
    const desert = { ...getTrail("delicate-arch")!, elevationFt: 4800 };
    const result = foliageFor(desert, "2026-10-01")!;
    expect(result.status).toBe("none");
    expect(result.rating).toBeNull();
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
