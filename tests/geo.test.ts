import { describe, expect, it } from "vitest";
import { bboxAround, gridCentre, gridKey, haversineMi } from "@/lib/geo";
import { selectCandidates } from "@/lib/report";
import { trail } from "./fixtures";
import type { Trail } from "@/lib/types";

const trailAt = (id: string, lat: number, lon: number): Trail => trail({ id, lat, lon });

describe("haversineMi", () => {
  it("measures a known city pair to within a few miles", () => {
    // Salt Lake City to Provo is roughly 38 miles as the crow flies.
    const distance = haversineMi(
      { lat: 40.7608, lon: -111.891 },
      { lat: 40.2338, lon: -111.6585 },
    );
    expect(distance).toBeGreaterThan(33);
    expect(distance).toBeLessThan(43);
  });

  it("returns zero for the same point", () => {
    const point = { lat: 40.5, lon: -111.7 };
    expect(haversineMi(point, point)).toBeCloseTo(0, 6);
  });

  it("is symmetric", () => {
    const a = { lat: 39.1, lon: -110.2 };
    const b = { lat: 41.4, lon: -112.8 };
    expect(haversineMi(a, b)).toBeCloseTo(haversineMi(b, a), 9);
  });
});

describe("grid clustering", () => {
  it("puts two trailheads in the same canyon in one cell", () => {
    // Donut Falls and Desolation Lake, a few miles apart in the Wasatch.
    const a = gridKey({ lat: 40.6318, lon: -111.6975 });
    const b = gridKey({ lat: 40.6866, lon: -111.658 });
    expect(a).toBe(b);
  });

  it("separates trailheads hundreds of miles apart", () => {
    const wasatch = gridKey({ lat: 40.6318, lon: -111.6975 });
    const moab = gridKey({ lat: 38.5808, lon: -109.5205 });
    expect(wasatch).not.toBe(moab);
  });

  it("round-trips a cell key back to a point inside the cell", () => {
    const point = { lat: 40.6318, lon: -111.6975 };
    const centre = gridCentre(gridKey(point));
    expect(haversineMi(point, centre)).toBeLessThan(15);
  });
});

describe("bboxAround", () => {
  it("produces a box that contains its centre", () => {
    const point = { lat: 40.5, lon: -111.7 };
    const box = bboxAround(point, 35);
    expect(box.minLat).toBeLessThan(point.lat);
    expect(box.maxLat).toBeGreaterThan(point.lat);
    expect(box.minLon).toBeLessThan(point.lon);
    expect(box.maxLon).toBeGreaterThan(point.lon);
  });

  it("widens longitude more than latitude away from the equator", () => {
    const box = bboxAround({ lat: 60, lon: 0 }, 35);
    expect(box.maxLon - box.minLon).toBeGreaterThan(box.maxLat - box.minLat);
  });
});

describe("selectCandidates", () => {
  const near = trailAt("near", 40.6, -111.6);
  const mid = trailAt("mid", 40.9, -111.9);
  const far = trailAt("far", 38.5, -109.5);

  it("returns everything when under the cap", () => {
    expect(selectCandidates([near, far], 5).map((t) => t.id)).toEqual(["near", "far"]);
  });

  it("keeps the nearest areas when an origin is given", () => {
    const picked = selectCandidates([far, mid, near], 2, { lat: 40.62, lon: -111.62 });
    expect(picked.map((t) => t.id)).toEqual(["near", "mid"]);
  });

  it("falls back to the most substantial areas with no origin", () => {
    const big = { ...trailAt("big", 39, -111), routes: 400 };
    const small = { ...trailAt("small", 39, -111), routes: 8 };
    expect(selectCandidates([small, big], 1).map((t) => t.id)).toEqual(["big"]);
  });
});
