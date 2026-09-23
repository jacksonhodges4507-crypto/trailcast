import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIRMATIONS_NEEDED,
  kindsFor,
  sanitizeNote,
  summarize,
  type StoredReport,
} from "@/lib/reports/kinds";
import { reporterId, submitReport } from "@/lib/reports/service";
import { setReportStore } from "@/lib/reports/store";
import { fishingGuide, hasGuide, watersFor } from "@/lib/fishing/guide";
import { routeFigures } from "@/lib/format";
import { clockTime, daylightRule } from "@/lib/scoring/rules";
import { parseQuery } from "@/lib/ask/parse";
import { crowdSentence, preferenceBonus, rankByProximity } from "@/lib/ask/answer";
import { scoreTrail } from "@/lib/scoring";
import { TRAILS } from "@/lib/trails";
import { goodConditions, trail } from "./fixtures";
import type { TrailReport } from "@/lib/types";

const NOW = new Date("2026-09-17T18:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("report confirmation", () => {
  it("needs two different people, not two submissions", () => {
    expect(CONFIRMATIONS_NEEDED).toBe(2);
    const sameVoice: StoredReport[] = [
      { kind: "muddy", at: hoursAgo(1), who: "a" },
      { kind: "muddy", at: hoursAgo(2), who: "a" },
      { kind: "muddy", at: hoursAgo(3), who: "a" },
    ];
    const one = summarize(sameVoice, NOW);
    expect(one.confirmed).toHaveLength(0);
    expect(one.awaiting).toBe(1);

    const two = summarize([...sameVoice, { kind: "muddy", at: hoursAgo(4), who: "b" }], NOW);
    expect(two.confirmed.map((c) => c.kind)).toEqual(["muddy"]);
    expect(two.confirmed[0]?.reporters).toBe(2);
  });

  it("ignores reports older than the window", () => {
    const stale = summarize(
      [
        { kind: "snow", at: hoursAgo(50), who: "a" },
        { kind: "snow", at: hoursAgo(1), who: "b" },
      ],
      NOW,
    );
    expect(stale.confirmed).toHaveLength(0);
  });

  it("lists bad news before good news", () => {
    const mixed = summarize(
      [
        { kind: "dry", at: hoursAgo(1), who: "a" },
        { kind: "dry", at: hoursAgo(1), who: "b" },
        { kind: "dry", at: hoursAgo(1), who: "c" },
        { kind: "closed", at: hoursAgo(1), who: "a" },
        { kind: "closed", at: hoursAgo(1), who: "b" },
      ],
      NOW,
    );
    expect(mixed.confirmed.map((c) => c.kind)).toEqual(["closed", "dry"]);
  });

  it("drops unknown kinds", () => {
    const junk = summarize(
      [
        { kind: "free-money", at: hoursAgo(1), who: "a" },
        { kind: "free-money", at: hoursAgo(1), who: "b" },
      ],
      NOW,
    );
    expect(junk.confirmed).toHaveLength(0);
  });

  it("sanitises notes", () => {
    expect(sanitizeNote("  mud on the\nfirst mile  ")).toBe("mud on the first mile");
    expect(sanitizeNote("deals at https://spam.example now")).toBe("deals at now");
    expect(sanitizeNote("x".repeat(500))).toHaveLength(140);
    expect(sanitizeNote("   ")).toBeUndefined();
    expect(sanitizeNote(42)).toBeUndefined();
  });

  it("offers only kinds that fit the activity", () => {
    const fish = kindsFor("fish").map((k) => k.id);
    expect(fish).toContain("good-bite");
    expect(fish).toContain("closed");
    expect(fish).not.toContain("dry-rock");
    expect(kindsFor("climb").map((k) => k.id)).toContain("dry-rock");
  });

  it("never keeps the raw address", () => {
    const id = reporterId("203.0.113.9");
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(id).not.toContain("203");
    expect(reporterId("203.0.113.10")).not.toBe(id);
  });
});

describe("submitReport", () => {
  afterEach(() => setReportStore(null));

  const hike = TRAILS.find((t) => t.activities.includes("hike") && !t.activities.includes("fish"));

  it("confirms on the second distinct person", async () => {
    setReportStore(null);
    expect(hike).toBeDefined();
    const first = await submitReport({ trailId: hike!.id, kind: "muddy", note: "", address: "198.51.100.1" });
    expect(first.ok && first.confirmedNow).toBe(false);
    const again = await submitReport({ trailId: hike!.id, kind: "muddy", note: "", address: "198.51.100.1" });
    expect(again.ok && again.confirmedNow).toBe(false);
    const second = await submitReport({ trailId: hike!.id, kind: "muddy", note: "", address: "198.51.100.2" });
    expect(second.ok && second.confirmedNow).toBe(true);
  });

  it("rejects unknown places and kinds that do not apply", async () => {
    setReportStore(null);
    const unknown = await submitReport({ trailId: "nope", kind: "muddy", note: "", address: "x" });
    expect(unknown.ok).toBe(false);
    const wrong = await submitReport({ trailId: hike!.id, kind: "good-bite", note: "", address: "x" });
    expect(wrong.ok).toBe(false);
  });

  it("rate-limits one person", async () => {
    setReportStore(null);
    let last: Awaited<ReturnType<typeof submitReport>> | undefined;
    for (let i = 0; i < 9; i += 1) {
      last = await submitReport({ trailId: hike!.id, kind: "dry", note: "", address: "192.0.2.7" });
    }
    expect(last && !last.ok && last.status).toBe(429);
  });
});

describe("fishing guide", () => {
  it("leads September on the Green with tricos, and adds scuds on a tailwater", () => {
    const guide = fishingGuide("green-river-a-section", "2026-09-20");
    expect(guide).not.toBeNull();
    expect(guide!.month).toBe("September");
    expect(guide!.flies[0]?.name).toBe("Trico spinner");
    expect(guide!.eating).toContain("scuds and sowbugs");
    expect(guide!.lures.length).toBeGreaterThan(0);
  });

  it("uses cicadas on the Green in June, not in September", () => {
    const june = fishingGuide("green-river-a-section", "2026-06-10")!;
    expect(june.flies[0]?.name).toBe("Foam cicada");
    const sept = fishingGuide("green-river-a-section", "2026-09-10")!;
    expect(sept.flies.some((f) => f.name === "Foam cicada")).toBe(false);
  });

  it("switches stillwater by season", () => {
    const winter = fishingGuide("strawberry-reservoir", "2026-01-15")!;
    expect(winter.type).toBe("stillwater");
    expect(winter.eating.join(" ")).toMatch(/ice/);
    const summer = fishingGuide("strawberry-reservoir", "2026-07-15")!;
    expect(summer.eating.join(" ")).not.toMatch(/under the ice/);
  });

  it("does not add scuds to a freestone river", () => {
    const logan = fishingGuide("logan-river", "2026-09-20")!;
    expect(logan.eating).not.toContain("scuds and sowbugs");
  });

  it("returns nothing for places without fishing data", () => {
    expect(fishingGuide("not-a-river", "2026-09-20")).toBeNull();
    expect(hasGuide("not-a-river")).toBe(false);
  });

  it("knows where each fish lives", () => {
    expect(watersFor("kokanee")).toContain("strawberry-reservoir");
    expect(watersFor("bonneville-cutthroat")).toContain("logan-river");
  });

  it("only guides waters that exist as places", () => {
    for (const id of ["green-river-a-section", "logan-river", "strawberry-reservoir"]) {
      expect(TRAILS.some((t) => t.id === id)).toBe(true);
    }
  });
});

describe("route figures", () => {
  const route = { distanceMi: 6.9, gainFt: 1800, sourceName: "Curated" };

  it("labels each figure so it is not read as distance away", () => {
    expect(routeFigures(route, "hike")).toEqual(["6.9 mi round trip", "1,800 ft gain"]);
    expect(routeFigures(route, "climb")).toEqual(["6.9 mi approach", "1,800 ft gain"]);
    expect(routeFigures(route, "fish")).toEqual(["6.9 mi of access"]);
  });

  it("shows nothing for imported areas with placeholder figures", () => {
    expect(routeFigures({ ...route, sourceName: "OpenBeta" }, "climb")).toEqual([]);
  });
});

describe("daylight", () => {
  it("formats local clock times", () => {
    expect(clockTime("2026-09-19T07:05")).toBe("7:05 am");
    expect(clockTime("2026-09-19T19:17")).toBe("7:17 pm");
    expect(clockTime("2026-09-19T12:00")).toBe("12:00 pm");
    expect(clockTime(undefined)).toBeUndefined();
  });

  it("varies with the outing instead of repeating the day length", () => {
    const short = daylightRule({ trail: trail({ distanceMi: 3, gainFt: 400 }), conditions: goodConditions(), activity: "hike" });
    const long = daylightRule({ trail: trail({ distanceMi: 16, gainFt: 4500 }), conditions: goodConditions(), activity: "hike" });
    expect(short.display).toMatch(/h spare$/);
    expect(short.display).not.toBe(long.display);
    expect(short.reason).toMatch(/7:05 am/);
  });

  it("calls for a headlamp when the outing will not fit", () => {
    const result = daylightRule({
      trail: trail({ distanceMi: 30, gainFt: 9000 }),
      conditions: goodConditions({ daylightHours: 9.5 }),
      activity: "hike",
    });
    expect(result.display).toBe("headlamp needed");
  });
});

describe("parser intents", () => {
  const TODAY = "2026-09-17";

  it("reads easy, hard, shade and water", () => {
    const easy = parseQuery("an easy hike", TODAY);
    expect(easy.maxDistanceMi).toBe(5);
    expect(easy.maxGainFt).toBe(1200);
    expect(parseQuery("a long hard hike", TODAY).minGainFt).toBe(2000);
    expect(parseQuery("somewhere shady to hike", TODAY).preferShade).toBe(true);
    expect(parseQuery("hike to a waterfall", TODAY).wantsWater).toBe(true);
  });

  it("different questions give different interpretations", () => {
    const a = parseQuery("easy hike saturday", TODAY).interpretation;
    const b = parseQuery("shady hike saturday", TODAY).interpretation;
    expect(a).not.toBe(b);
  });

  it("a species means fishing", () => {
    const q = parseQuery("where are the browns eating", TODAY);
    expect(q.activity).toBe("fish");
    expect(q.species).toBe("brown");
    expect(parseQuery("cutthroat this weekend", TODAY).species).toBe("bonneville-cutthroat");
  });

  it("reads rock type", () => {
    expect(parseQuery("sandstone climbing", TODAY).rockType).toBe("sandstone");
  });
});

describe("preferences in ranking", () => {
  const report = (id: string, score: number, exposed: boolean): TrailReport => {
    const t = trail({ id, name: id, exposed });
    const verdict = scoreTrail(t, goodConditions(), "hike");
    return { trail: t, conditions: goodConditions(), verdict: { ...verdict, score } };
  };

  it("lifts shaded places without hiding exposed ones", () => {
    const q = parseQuery("shady hike", "2026-09-17");
    expect(preferenceBonus(q, trail({ exposed: false }))).toBeGreaterThan(0);
    expect(preferenceBonus(q, trail({ exposed: true }))).toBe(0);

    const ranked = rankByProximity([report("exposed", 80, true), report("shaded", 78, false)], undefined, q);
    expect(ranked.map((r) => r.trail.id)).toEqual(["shaded", "exposed"]);
    expect(ranked).toHaveLength(2);
  });

  it("does not let a preference beat a big conditions gap", () => {
    const q = parseQuery("shady hike", "2026-09-17");
    const ranked = rankByProximity([report("exposed", 95, true), report("shaded", 60, false)], undefined, q);
    expect(ranked[0]?.trail.id).toBe("exposed");
  });
});

describe("crowd sentence", () => {
  const base = (): TrailReport => {
    const t = trail();
    return { trail: t, conditions: goodConditions(), verdict: scoreTrail(t, goodConditions(), "hike") };
  };

  it("is silent with no confirmed reports", () => {
    expect(crowdSentence(base())).toBeNull();
  });

  it("names worrying reports as reported, not measured", () => {
    const withCrowd: TrailReport = {
      ...base(),
      crowd: [
        { kind: "muddy", label: "Muddy", glyph: "", tone: "warn", reporters: 3, latest: NOW.toISOString(), notes: [] },
        { kind: "dry", label: "Dry", glyph: "", tone: "good", reporters: 2, latest: NOW.toISOString(), notes: [] },
      ],
    };
    const sentence = crowdSentence(withCrowd)!;
    expect(sentence).toMatch(/muddy \(3 people\)/);
    expect(sentence).toMatch(/not measured/);
    expect(sentence).not.toMatch(/dry/i);
  });
});

import { quickStats } from "@/lib/format";

describe("quick stats", () => {
  it("formats the glance numbers and dashes what is missing", () => {
    const stats = quickStats({
      trail: { distanceMi: 6.4 },
      conditions: { tempMaxF: 63.6, windMph: 7.7 },
      verdict: { activity: "hike" },
    });
    // The fifth tile is the dog rule, which this trail has not had checked.
    expect(stats.map((s) => s.value)).toEqual(["64°F", "8 mph", "—", "6.4 mi", "—"]);
    expect(stats.map((s) => s.label)).toEqual(["High", "Wind", "Rain", "Length", "Dogs"]);
  });

  it("counts routes for climbing instead of a length", () => {
    const stats = quickStats({ trail: { distanceMi: 0.5, routes: 136 }, conditions: {}, verdict: { activity: "climb" } });
    expect(stats[3]).toEqual({ value: "136", label: "Routes" });
  });
});

import { templateNarrative } from "@/lib/ask/answer";

describe("Scout's voice", () => {
  it("answers like a person, not a report", () => {
    const t = trail({ id: "friendly", name: "Friendly Trail" });
    const report: TrailReport = { trail: t, conditions: goodConditions(), verdict: scoreTrail(t, goodConditions(), "hike") };
    const text = templateNarrative(parseQuery("hike saturday", "2026-09-17"), [report], "2026-09-17");
    expect(text).toMatch(/I'd/);
    expect(text).toContain("Friendly Trail");
    expect(text).not.toMatch(/is the pick/);
  });
});
