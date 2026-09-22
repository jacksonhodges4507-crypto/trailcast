import { describe, expect, it } from "vitest";
import { TRAILS } from "@/lib/trails";
import { isDwrTrail, prettyName, countyName } from "@/lib/fishing/dwr";
import { allWatersFor, fishingGuide, hasGuide, holdsSpecies } from "@/lib/fishing/guide";

const dwr = TRAILS.filter(isDwrTrail);

describe("DWR water names", () => {
  it("expands DWR's field abbreviations", () => {
    expect(prettyName("DEER CR RES")).toBe("Deer Creek Reservoir");
    expect(prettyName("YUBA RES (SEVIER BRG")).toBe("Yuba Reservoir (Sevier Bridge)");
  });

  it("maps county codes", () => {
    expect(countyName("29")).toBe("Weber County");
  });
});

describe("statewide fishing waters", () => {
  it("loads the whole DWR list", () => {
    expect(dwr.length).toBeGreaterThan(900);
  });

  it("gives every water a guide", () => {
    for (const water of dwr.slice(0, 50)) expect(hasGuide(water.id)).toBe(true);
  });

  it("only lists them for fishing", () => {
    for (const water of dwr.slice(0, 50)) expect(water.activities).toEqual(["fish"]);
  });
});

describe("generic DWR guide", () => {
  const jordanelle = dwr.find((t) => t.name === "Jordanelle Reservoir")!;
  const willard = dwr.find((t) => t.name === "Willard Bay Reservoir")!;

  it("treats a stocked reservoir as stillwater", () => {
    const guide = fishingGuide(jordanelle.id, "2026-07-15")!;
    expect(guide.type).toBe("stillwater");
    expect(guide.species.length).toBeGreaterThan(0);
    expect(guide.lures.length).toBeGreaterThan(0);
  });

  it("suggests warmwater tackle where warmwater fish live", () => {
    const guide = fishingGuide(willard.id, "2026-07-15")!;
    const names = guide.lures.map((l) => l.name).join(" ");
    expect(/walleye|crawler|swimbait|spoon/i.test(names)).toBe(true);
    expect(guide.flies).toEqual([]);
  });

  it("says plainly that it is a general pattern, not local knowledge", () => {
    const guide = fishingGuide(jordanelle.id, "2026-07-15")!;
    expect(guide.notes.join(" ")).toMatch(/not local knowledge/);
    expect(guide.regulations.join(" ")).toMatch(/Guidebook/);
  });

  it("still returns null for a place with no water", () => {
    expect(fishingGuide("angels-landing", "2026-07-15")).toBeNull();
  });
});

describe("species lookup", () => {
  it("finds DWR waters for a warmwater species", () => {
    const waters = allWatersFor("walleye");
    expect(waters.length).toBeGreaterThan(0);
    expect(waters.some((id) => id.startsWith("dwr-"))).toBe(true);
  });

  it("matches species on DWR waters", () => {
    const willard = dwr.find((t) => t.name === "Willard Bay Reservoir")!;
    expect(holdsSpecies(willard, "walleye")).toBe(true);
    expect(holdsSpecies(willard, "brook")).toBe(false);
  });
});
