import { describe, expect, it } from "vitest";
import { collectWalls } from "@/lib/sources/openbetaLive";
import { OSM_SPECS, simplify, toLines } from "@/lib/sources/osmLines";
import { OPENBETA_IDS } from "@/lib/data/openbetaIds";
import { SPECIES, SPECIES_IDS } from "@/lib/fishing/species";
import { TRAILS, getTrail } from "@/lib/trails";

describe("OpenBeta walls", () => {
  it("keeps located areas that hold routes, at any depth", () => {
    const walls = collectWalls({
      areaName: "Canyon",
      totalClimbs: 3,
      metadata: { lat: 40, lng: -111, leaf: false },
      climbs: [],
      children: [
        {
          areaName: " Main Wall ",
          totalClimbs: 2,
          metadata: { lat: 40.1, lng: -111.1, leaf: true },
          climbs: [{ name: "A" }, { name: "B" }],
          children: [],
        },
        {
          areaName: "Sector",
          totalClimbs: 1,
          metadata: { lat: 40.2, lng: -111.2, leaf: false },
          children: [
            { areaName: "Boulder", totalClimbs: 1, metadata: { lat: 40.3, lng: -111.3, leaf: true }, children: [] },
          ],
        },
        { areaName: "Nowhere", totalClimbs: 4, metadata: { lat: 0, lng: 0, leaf: true }, children: [] },
      ],
    });
    expect(walls.map((w) => w.wall.n)).toEqual(["Main Wall", "Boulder"]);
    expect(walls[0]?.wall.c).toBe(2);
    expect(walls[1]?.wall.c).toBe(1);
  });

  it("maps every OpenBeta id to a real climbing place", () => {
    for (const id of Object.keys(OPENBETA_IDS)) {
      const place = getTrail(id);
      expect(place).toBeDefined();
      expect(place!.activities).toContain("climb");
    }
    expect(Object.keys(OPENBETA_IDS).length).toBeGreaterThan(60);
  });
});

describe("OpenStreetMap lines", () => {
  it("simplifies a straight run down to its ends", () => {
    const line: [number, number][] = [
      [0, 0],
      [1, 0.00001],
      [2, 0],
      [3, 0.00001],
      [4, 0],
    ];
    expect(simplify(line, 0.001)).toEqual([
      [0, 0],
      [4, 0],
    ]);
  });

  it("keeps a real bend", () => {
    const bend: [number, number][] = [
      [0, 0],
      [1, 1],
      [2, 0],
    ];
    expect(simplify(bend, 0.01)).toHaveLength(3);
  });

  it("clips a river to the stretch near the place", () => {
    const spec = { kind: "river" as const, radius: 2000, name: "x" };
    const runs = toLines(
      [{ geometry: [{ lat: 40, lon: -111 }, { lat: 40.005, lon: -111 }, { lat: 40.5, lon: -111 }] }],
      spec,
      40,
      -111,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.every(([, lat]) => lat < 40.1)).toBe(true);
  });

  it("only describes places that exist", () => {
    for (const id of Object.keys(OSM_SPECS)) expect(TRAILS.some((t) => t.id === id)).toBe(true);
  });
});

describe("Fish Dex photos", () => {
  it("gives every species a credited, licensed photo", () => {
    for (const id of SPECIES_IDS) {
      const photo = SPECIES[id].photo;
      expect(photo.src).toMatch(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\//);
      expect(photo.src).toMatch(/\/500px-/);
      expect(photo.page).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(photo.credit.length).toBeGreaterThan(2);
    }
  });
});
