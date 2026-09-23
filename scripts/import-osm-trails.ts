/**
 * Refresh the statewide trail snapshot from OpenStreetMap.
 *
 *   npx tsx scripts/import-osm-trails.ts
 *
 * Utah's named trail routes -- the curated multi-way relations that people
 * actually name and search for -- plus their length and elevation profile.
 *
 * Why OSM and not a search engine: OSM's geometry is openly licensed and
 * redistributable, so the length, the trailhead and the shape are all facts
 * we can carry rather than numbers we would be inventing. A search engine's
 * trail descriptions are neither.
 *
 * This runs in CI (see .github/workflows/refresh-trails.yml) rather than on a
 * laptop: Overpass refuses cloud IP ranges often enough to be unusable from a
 * deploy target, and the elevation pass is a few hundred more requests.
 */
import { writeFileSync } from "node:fs";

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const ELEVATION = "https://api.open-meteo.com/v1/elevation";

/** Utah, with a little margin. */
const BBOX = "36.98,-114.07,42.02,-109.03";

const MIN_MI = 0.4;
const MAX_MI = 60;

interface Relation {
  id: number;
  tags?: Record<string, string>;
  center?: { lat: number; lon: number };
  members?: { type?: string; geometry?: { lat: number; lon: number }[] }[];
}

async function overpass(query: string, timeoutMs = 90_000): Promise<{ elements?: Relation[] } | null> {
  for (const host of OVERPASS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(host, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) continue;
      return (await response.json()) as { elements?: Relation[] };
    } catch {
      // Try the next mirror.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

const R = 6_371_000;
function metres(a: [number, number], b: [number, number]): number {
  const p = Math.PI / 180;
  const dLat = (b[1] - a[1]) * p;
  const dLon = (b[0] - a[0]) * p;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * p) * Math.cos(b[1] * p) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function clean(text: string): string {
  return text
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/["'\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What the route is for, as a bit mask: 1 walk, 2 run, 4 ride.
 *
 * Anything walkable is runnable -- a trail runner and a hiker want the same
 * tread -- so those travel together. Riding is separate because a hiking
 * trail is frequently closed to bikes.
 */
function activityMask(tags: Record<string, string>): number {
  const route = tags["route"] ?? "";
  if (route === "mtb") return 4;
  if (route === "bicycle") return tags["foot"] === "no" ? 4 : 4 | 1 | 2;
  return 1 | 2;
}

const SURFACE: Record<string, string> = {
  dirt: "d", ground: "d", earth: "d", soil: "d", grass: "d",
  clay: "c", mud: "c",
  rock: "r", stone: "r", bare_rock: "r",
  gravel: "g", fine_gravel: "g", compacted: "g", pebblestone: "g",
  asphalt: "p", paved: "p", concrete: "p",
};

/** Elevations for up to 100 points at a time, or nulls if the service is out. */
async function elevations(points: [number, number][]): Promise<(number | null)[]> {
  const lat = points.map((p) => p[1].toFixed(4)).join(",");
  const lon = points.map((p) => p[0].toFixed(4)).join(",");
  try {
    const response = await fetch(`${ELEVATION}?latitude=${lat}&longitude=${lon}`);
    if (!response.ok) return points.map(() => null);
    const body = (await response.json()) as { elevation?: number[] };
    return points.map((_, i) => body.elevation?.[i] ?? null);
  } catch {
    return points.map(() => null);
  }
}

async function main() {
  console.log("Asking Overpass for Utah's named trail routes…");
  const listed = await overpass(
    `[out:json][timeout:180];relation(${BBOX})[route~"^(hiking|foot|mtb|bicycle)$"][name];out tags center;`,
    180_000,
  );
  const all = listed?.elements ?? [];
  if (all.length === 0) throw new Error("Overpass returned no routes");

  // Utah only, real names, and no on-road bike routes dressed as trails.
  const inUtah = (c?: { lat: number; lon: number }) =>
    c !== undefined && c.lat > 36.99 && c.lat < 42.01 && c.lon > -114.06 && c.lon < -109.04;
  const trailish = (name: string) => /\b(trail|parkway|path|greenway|loop|rail|route)\b/i.test(name);

  const wanted = all.filter((r) => {
    const name = clean(r.tags?.["name"] ?? "");
    if (!name || name.length > 60) return false;
    if (!inUtah(r.center)) return false;
    if (/^(US|UT|SR)[- ]?\d/i.test(name)) return false;
    if (r.tags?.["route"] === "bicycle" && !trailish(name)) return false;
    return true;
  });
  console.log(`${wanted.length} routes to measure, of ${all.length} returned.`);

  interface Built {
    id: number;
    name: string;
    mask: number;
    lat: number;
    lon: number;
    miles: number;
    gainFt: number;
    elevationFt: number;
    surface: string;
    samples: [number, number][];
  }
  const built: Built[] = [];

  // Geometry a few at a time: a super-relation with `out geom` can be
  // enormous, and one timeout should cost three routes rather than all of
  // them.
  for (let i = 0; i < wanted.length; i += 3) {
    const batch = wanted.slice(i, i + 3);
    const body = await overpass(
      `[out:json][timeout:60];relation(id:${batch.map((r) => r.id).join(",")});out geom tags;`,
      70_000,
    );
    for (const relation of body?.elements ?? []) {
      const segments = (relation.members ?? [])
        .filter((m) => m.type === "way" && m.geometry && m.geometry.length > 1)
        .map((m) => m.geometry!.map((g) => [g.lon, g.lat] as [number, number]));
      if (segments.length === 0) continue;

      let length = 0;
      for (const segment of segments) {
        for (let k = 1; k < segment.length; k += 1) length += metres(segment[k - 1]!, segment[k]!);
      }
      const miles = length / 1609.34;
      if (miles < MIN_MI || miles > MAX_MI) continue;

      const flat = segments.flat();
      const count = Math.min(14, Math.max(4, Math.round(length / 600)));
      const samples: [number, number][] = [];
      for (let k = 0; k < count; k += 1) {
        samples.push(flat[Math.floor((k * (flat.length - 1)) / (count - 1))]!);
      }

      const tags = relation.tags ?? {};
      built.push({
        id: relation.id,
        name: clean(tags["name"] ?? "").slice(0, 48),
        mask: activityMask(tags),
        lat: Math.round(flat[0]![1] * 1e4) / 1e4,
        lon: Math.round(flat[0]![0] * 1e4) / 1e4,
        miles: Math.round(miles * 10) / 10,
        gainFt: 0,
        elevationFt: 0,
        surface: SURFACE[tags["surface"] ?? ""] ?? "d",
        samples,
      });
    }
    if (i % 60 === 0) console.log(`${i}/${wanted.length} measured, ${built.length} kept`);
    await new Promise((r) => setTimeout(r, 900));
  }

  console.log(`Sampling elevation for ${built.length} routes…`);
  for (const route of built) {
    const heights = await elevations(route.samples);
    const known = heights.filter((h): h is number => h !== null);
    if (known.length < 2) continue;

    let gain = 0;
    for (let i = 1; i < heights.length; i += 1) {
      const a = heights[i - 1];
      const b = heights[i];
      if (a === null || a === undefined || b === null || b === undefined) continue;
      if (b > a) gain += b - a;
    }
    route.elevationFt = Math.round((known[0] ?? 0) * 3.28084);
    route.gainFt = Math.round(gain * 3.28084);
    await new Promise((r) => setTimeout(r, 250));
  }

  built.sort((a, b) => b.miles - a.miles);

  const rows = built.map((b) => [
    `r${b.id}`,
    b.name,
    b.mask,
    b.lat,
    b.lon,
    "",
    Math.round(b.miles * 10),
    b.gainFt,
    b.elevationFt,
    b.surface,
  ]);

  const header = `/* Generated by scripts/import-osm-trails.ts on ${new Date().toISOString().slice(0, 10)}. Data (c) OpenStreetMap contributors, ODbL. Elevation from Open-Meteo. */\n`;
  writeFileSync(
    new URL("../src/lib/data/osmTrails.ts", import.meta.url),
    `${header}
/**
 * [osmId, name, activityMask, lat, lon, county, distanceMi*10, gainFt, elevationFt, surface]
 *
 * \`osmId\` is prefixed "r" for a relation and "w" for a way, so the row can
 * link back to the feature it came from. \`county\` is empty when the importer
 * could not name one; the builder fills it in.
 */
export type OsmTrailRow = [
  string, string, number, number, number, string, number, number, number, string,
];

export const OSM_TRAILS: OsmTrailRow[] = ${JSON.stringify(rows)};
`,
  );
  console.log(`Wrote ${rows.length} trails.`);
}

void main();
