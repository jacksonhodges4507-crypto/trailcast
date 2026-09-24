/**
 * Build the statewide trail snapshot from an OpenStreetMap extract.
 *
 *   osmium tags-filter utah.osm.pbf r/route=hiking r/route=foot \
 *     r/route=mtb r/route=bicycle -R -o routes.osm.pbf
 *   osmium cat routes.osm.pbf -f osm -o routes.osm
 *   npx tsx scripts/import-osm-trails.ts routes.osm
 *
 * See .github/workflows/refresh-trails.yml, which does all of that.
 *
 * This used to query the Overpass API, tile by tile, and it was the wrong
 * tool for the job. Overpass is built for interactive questions about small
 * areas, not for bulk extraction of a whole state, and it says so by
 * refusing: across three attempts it managed two tiles out of nine in
 * twenty-seven minutes, and by the end it was returning a gateway timeout in
 * eight seconds flat to every query regardless of size -- a statewide one
 * and a two-degree one alike. That is a server shedding load, and no amount
 * of client tuning fixes it. Three rounds of tuning is the evidence.
 *
 * Geofabrik publishes the same data as a 161 MB file, rebuilt daily. One
 * download, no rate limit, no slot protocol, no refusals, and the same
 * answer every time -- which is what a scheduled job that nobody watches
 * actually needs. osmium reduces it to the few megabytes of route relations
 * in one pass; this script reads that.
 */
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const ELEVATION = "https://api.open-meteo.com/v1/elevation";

/** Utah, with a little margin. The extract already is Utah; this is a guard. */
const STATE = { south: 36.9, west: -114.2, north: 42.1, east: -108.9 };

const MIN_MI = 0.4;
const MAX_MI = 60;

/** A name that sounds like somewhere you walk or ride, not a road number. */
const TRAILISH = /\b(trail|parkway|path|greenway|loop|rail|route|traverse)\b/i;

/**
 * Networks that are long-distance by definition. The Arizona Trail and the
 * Great Western cross Utah and are never a day out.
 */
const THROUGH_NETWORKS = new Set(["iwn", "nwn"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** XML attribute, from osmium's very regular output. */
function attr(line: string, name: string): string | undefined {
  const match = line.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1];
}

function decode(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

interface ParsedRelation {
  id: number;
  tags: Record<string, string>;
  wayIds: number[];
}

interface Extract {
  nodes: Map<number, [number, number]>;
  ways: Map<number, number[]>;
  relations: ParsedRelation[];
}

/**
 * Read the filtered extract.
 *
 * osmium writes nodes, then ways, then relations, one element per line, so a
 * line-at-a-time reader is enough and never holds the file in memory. The
 * extract carries only what the route relations reference, so the maps stay
 * small.
 */
async function readExtract(path: string): Promise<Extract> {
  const nodes = new Map<number, [number, number]>();
  const ways = new Map<number, number[]>();
  const relations: ParsedRelation[] = [];

  let wayId: number | null = null;
  let wayNodes: number[] = [];
  let relId: number | null = null;
  let relTags: Record<string, string> = {};
  let relWays: number[] = [];

  const reader = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const raw of reader) {
    const line = raw.trim();

    if (line.startsWith("<node")) {
      const id = Number(attr(line, "id"));
      const lat = Number(attr(line, "lat"));
      const lon = Number(attr(line, "lon"));
      if (Number.isFinite(id) && Number.isFinite(lat) && Number.isFinite(lon)) {
        nodes.set(id, [lon, lat]);
      }
      continue;
    }

    if (line.startsWith("<way")) {
      wayId = Number(attr(line, "id"));
      wayNodes = [];
      if (line.endsWith("/>")) {
        if (Number.isFinite(wayId)) ways.set(wayId, []);
        wayId = null;
      }
      continue;
    }
    if (wayId !== null && line.startsWith("<nd")) {
      const ref = Number(attr(line, "ref"));
      if (Number.isFinite(ref)) wayNodes.push(ref);
      continue;
    }
    if (wayId !== null && line.startsWith("</way")) {
      ways.set(wayId, wayNodes);
      wayId = null;
      continue;
    }

    if (line.startsWith("<relation")) {
      relId = Number(attr(line, "id"));
      relTags = {};
      relWays = [];
      if (line.endsWith("/>")) relId = null;
      continue;
    }
    if (relId !== null && line.startsWith("<member")) {
      if (attr(line, "type") === "way") {
        const ref = Number(attr(line, "ref"));
        if (Number.isFinite(ref)) relWays.push(ref);
      }
      continue;
    }
    if (relId !== null && line.startsWith("<tag")) {
      const k = attr(line, "k");
      const v = attr(line, "v");
      if (k !== undefined && v !== undefined) relTags[k] = decode(v);
      continue;
    }
    if (relId !== null && line.startsWith("</relation")) {
      relations.push({ id: relId, tags: relTags, wayIds: relWays });
      relId = null;
      continue;
    }
  }

  return { nodes, ways, relations };
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

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: tsx scripts/import-osm-trails.ts <routes.osm>");

  console.log(`Reading ${path}…`);
  const { nodes, ways, relations } = await readExtract(path);
  console.log(
    `${relations.length} relations, ${ways.size} ways, ${nodes.size} nodes in the extract.`,
  );
  if (relations.length === 0) {
    throw new Error("The extract holds no relations. The osmium filter produced nothing.");
  }

  const built: Built[] = [];
  let throughRoutes = 0;
  let noGeometry = 0;

  for (const relation of relations) {
    const tags = relation.tags;
    const name = clean(tags["name"] ?? "");
    if (!name || name.length > 60) continue;
    if (THROUGH_NETWORKS.has(tags["network"] ?? "")) {
      throughRoutes += 1;
      continue;
    }
    if (/^(US|UT|SR|I)[- ]?\d/i.test(name)) continue;
    if (tags["route"] === "bicycle" && !TRAILISH.test(name)) continue;

    const segments: [number, number][][] = [];
    for (const id of relation.wayIds) {
      const refs = ways.get(id);
      if (!refs || refs.length < 2) continue;
      const points: [number, number][] = [];
      for (const ref of refs) {
        const point = nodes.get(ref);
        if (point) points.push(point);
      }
      if (points.length > 1) segments.push(points);
    }
    if (segments.length === 0) {
      noGeometry += 1;
      continue;
    }

    let length = 0;
    for (const segment of segments) {
      for (let k = 1; k < segment.length; k += 1) length += metres(segment[k - 1]!, segment[k]!);
    }
    const miles = length / 1609.34;
    if (miles < MIN_MI || miles > MAX_MI) continue;

    const flat = segments.flat();
    const start = flat[0]!;
    if (start[1] < STATE.south || start[1] > STATE.north) continue;
    if (start[0] < STATE.west || start[0] > STATE.east) continue;

    const count = Math.min(14, Math.max(4, Math.round(length / 600)));
    const samples: [number, number][] = [];
    for (let k = 0; k < count; k += 1) {
      samples.push(flat[Math.floor((k * (flat.length - 1)) / (count - 1))]!);
    }

    built.push({
      id: relation.id,
      name: name.slice(0, 48),
      mask: activityMask(tags),
      lat: Math.round(start[1] * 1e4) / 1e4,
      lon: Math.round(start[0] * 1e4) / 1e4,
      miles: Math.round(miles * 10) / 10,
      gainFt: 0,
      elevationFt: 0,
      surface: SURFACE[tags["surface"] ?? ""] ?? "d",
      samples,
    });
  }

  console.log(
    `${built.length} trails kept (${throughRoutes} through-routes, ` +
      `${noGeometry} without usable geometry).`,
  );
  if (built.length === 0) {
    throw new Error("Read the extract but kept no trails. Refusing to write an empty snapshot.");
  }

  console.log("Sampling elevation…");
  for (const [index, route] of built.entries()) {
    const heights = await elevations(route.samples);
    const known = heights.filter((h): h is number => h !== null);
    if (known.length >= 2) {
      let gain = 0;
      for (let i = 1; i < heights.length; i += 1) {
        const a = heights[i - 1];
        const b = heights[i];
        if (a === null || a === undefined || b === null || b === undefined) continue;
        if (b > a) gain += b - a;
      }
      route.elevationFt = Math.round((known[0] ?? 0) * 3.28084);
      route.gainFt = Math.round(gain * 3.28084);
    }
    if (index % 100 === 0) console.log(`  elevation ${index}/${built.length}`);
    await sleep(200);
  }

  built.sort((a, b) => a.name.localeCompare(b.name));

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
