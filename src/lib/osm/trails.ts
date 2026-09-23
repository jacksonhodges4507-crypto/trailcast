import type { ActivityId, Trail } from "../types";
import { OSM_TRAILS, type OsmTrailRow } from "../data/osmTrails";
import { DWR_WATERS } from "../data/dwrWaters";
import { countyName } from "../fishing/dwr";

/**
 * Named trails across Utah, from OpenStreetMap.
 *
 * The hand-curated set was twenty-odd trails along the Wasatch Front, which
 * is fine for showing what the scoring engine does and useless to anyone
 * living in St. George or Logan. OSM's named route relations are the
 * closest thing to a public, openly licensed trail inventory: they are
 * curated by people who walk them, they carry real geometry, and unlike a
 * search engine's results they can be redistributed.
 *
 * What OSM does not carry is the attribute set the scoring engine wants —
 * aspect, tree cover, stream crossings. Those are hand-curated fields and
 * they stay that way: rather than invent them, imported trails take neutral
 * values and the panel says the trail came from OSM, so a reader can tell a
 * surveyed entry from an imported one.
 */

/** Bit flags: what the OSM tags say the trail is for. */
export const ACT_HIKE = 1;
export const ACT_RUN = 2;
export const ACT_MTB = 4;

const SURFACE: Record<string, Trail["surface"]> = {
  d: "dirt",
  c: "clay",
  r: "rock",
  g: "gravel",
  m: "mixed",
};

export type OsmTrail = Trail & { osmId: string };

function activitiesOf(mask: number): ActivityId[] {
  const out: ActivityId[] = [];
  if (mask & ACT_HIKE) out.push("hike");
  if (mask & ACT_RUN) out.push("trail_run");
  if (mask & ACT_MTB) out.push("mtb");
  return out.length > 0 ? out : ["hike"];
}

/**
 * The county a point falls in, taken from the nearest DWR water.
 *
 * DWR's stocking records cover a thousand waters spread across every county
 * with their county stated, which makes them a free, reasonably dense
 * gazetteer. It is a nearest-neighbour guess, not a boundary test, so it can
 * be wrong within a few miles of a county line — which is why the region is
 * only ever used as a label, never to filter or to score.
 */
export function nearestCounty(lat: number, lon: number): string {
  let best = "";
  let bestDist = Infinity;
  for (const row of DWR_WATERS) {
    const dLat = row[3] - lat;
    const dLon = (row[4] - lon) * 0.76;
    const dist = dLat * dLat + dLon * dLon;
    if (dist < bestDist) {
      bestDist = dist;
      best = row[5];
    }
  }
  return best ? countyName(best) : "Utah";
}

function describe(row: OsmTrailRow): string {
  const [, , mask, , , , tenths, gainFt] = row;
  const miles = tenths / 10;
  const uses = activitiesOf(mask);
  const use =
    uses.length === 3
      ? "walked, run and ridden"
      : uses.includes("mtb") && uses.length === 1
        ? "a mountain-bike trail"
        : uses.includes("mtb")
          ? "shared with bikes"
          : "a walking trail";

  const shape =
    gainFt >= 2500
      ? "a serious climb"
      : gainFt >= 1000
        ? "a decent climb"
        : gainFt >= 300
          ? "gently uphill"
          : "close to flat";

  return `About ${miles < 1 ? miles.toFixed(1) : Math.round(miles)} mi and ${gainFt.toLocaleString()} ft of gain, ${shape} — ${use}. Mapped by OpenStreetMap contributors; the trailhead attributes TrailCast usually hand-checks aren't surveyed for this one.`;
}

function toTrail(row: OsmTrailRow): OsmTrail {
  const [osmId, name, mask, lat, lon, county, tenths, gainFt, elevationFt, surface] = row;
  return {
    id: `osm-${osmId}`,
    osmId,
    name,
    region: county || nearestCounty(lat, lon),
    state: "UT",
    lat,
    lon,
    elevationFt,
    gainFt,
    distanceMi: Math.round((tenths / 10) * 10) / 10,
    activities: activitiesOf(mask),
    surface: SURFACE[surface] ?? "dirt",
    // Not surveyed. "mixed" and a conservative exposure keep the scoring
    // honest rather than asserting an aspect nobody checked.
    aspect: "mixed",
    exposed: elevationFt >= 9500,
    waterCrossings: 0,
    blurb: describe(row),
    sourceName: "OpenStreetMap",
    sourceUrl: `https://www.openstreetmap.org/${osmId.startsWith("r") ? "relation" : "way"}/${osmId.slice(1)}`,
  };
}

/**
 * Every imported trail, minus any that duplicates a hand-curated one
 * (curated entries carry surveyed attributes and win).
 */
export function osmTrailList(curated: Trail[]): OsmTrail[] {
  const land = curated.filter((t) =>
    t.activities.some((a) => a === "hike" || a === "trail_run" || a === "mtb"),
  );
  const firstWord = (s: string) => s.toLowerCase().split(/\s+/)[0] ?? "";

  const seen = new Map<string, number>();
  const out: OsmTrail[] = [];

  for (const row of OSM_TRAILS) {
    const trail = toTrail(row);
    const duplicate = land.some(
      (c) =>
        Math.abs(c.lat - trail.lat) < 0.03 &&
        Math.abs(c.lon - trail.lon) < 0.04 &&
        firstWord(c.name) === firstWord(trail.name),
    );
    if (duplicate) continue;

    const key = `${trail.name}|${trail.region}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) trail.name = `${trail.name} (${count})`;
    out.push(trail);
  }
  return out;
}

export function isOsmTrail(trail: Trail): trail is OsmTrail {
  return (trail as Partial<OsmTrail>).osmId !== undefined;
}
