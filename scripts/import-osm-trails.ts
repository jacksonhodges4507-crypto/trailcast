/**
 * Refresh the statewide trail snapshot from OpenStreetMap.
 *
 *   npx tsx scripts/import-osm-trails.ts
 *
 * Utah's named trail routes -- the curated multi-way relations that people
 * actually name and search for -- with their real length and elevation gain
 * measured from geometry rather than guessed.
 *
 * Why OSM and not a search engine: OSM's geometry is openly licensed and
 * redistributable, so the length, the trailhead and the shape are facts we
 * can carry. A search engine's trail descriptions are not.
 *
 * Why this runs in CI: Overpass refuses cloud IP ranges, and the dev sandbox
 * has no route to it at all.
 *
 * Three things were learned the expensive way and are now load-bearing:
 *
 *   1. `[route~"^(hiking|foot|mtb)$"]` forces a full scan and times out. A
 *      union of exact `["route"="hiking"]` matches uses the tag index and
 *      returns the same rows in about two seconds.
 *   2. Utah in one query is too much for a public endpoint no matter how the
 *      filter is written. The state is walked as tiles.
 *   3. A 504 from Overpass usually means "busy", not "wrong". Every failure
 *      here is retried with a real backoff before the tile is split, because
 *      the first version treated a busy server as an empty state and wrote
 *      down that Utah has no trails.
 */
import { writeFileSync } from "node:fs";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const ELEVATION = "https://api.open-meteo.com/v1/elevation";

/** Utah, with a little margin. */
const STATE = { south: 36.98, west: -114.07, north: 42.02, east: -109.03 };

/** A tile this wide is one Overpass query. Dense ones get quartered. */
const TILE_DEGREES = 1;
/** Stop splitting here; below this a tile is smaller than a trailhead. */
const MIN_TILE_DEGREES = 0.125;

/** A courtesy pause between queries, on top of the slot wait below. */
const POLITE_MS = 1_500;
/** Fallback waits, only for a mirror that publishes no slot status. */
const BACKOFF_MS = [15_000, 30_000, 60_000];
/** How many times a tile is retried before it is split. */
const ATTEMPTS = 4;

/** Relations per geometry request. Small, so one monster is cheap to isolate. */
const GEOMETRY_BATCH = 8;

/** A name that sounds like somewhere you walk or ride, not a road number. */
const TRAILISH = /\b(trail|parkway|path|greenway|loop|rail|route|traverse)\b/i;

const MIN_MI = 0.4;
const MAX_MI = 60;

interface Member {
  type?: string;
  geometry?: { lat: number; lon: number }[];
}
interface Relation {
  id: number;
  tags?: Record<string, string>;
  members?: Member[];
}
interface Box {
  south: number;
  west: number;
  north: number;
  east: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tags only: cheap, and it always answers. */
function listQuery(box: Box): string {
  const b = `${box.south},${box.west},${box.north},${box.east}`;
  // Exact matches, not a regex: see note 1 at the top of this file.
  const clauses = ["hiking", "foot", "mtb", "bicycle"]
    .map((route) => `relation(${b})["route"="${route}"]["name"];`)
    .join("");
  return `[out:json][timeout:180];(${clauses});out tags center;`;
}

/**
 * Geometry for a named handful of relations.
 *
 * `out body geom` and not `out geom tags`, which is what this said for most
 * of a day. Overpass reads the first word as verbosity, and `tags` means id
 * and tags ONLY -- no members. The request returned 200, returned every
 * relation, returned their names, and returned not one coordinate. Every
 * route then measured zero length, every route was dropped for being under
 * the minimum, and the import would have walked the whole state to write an
 * empty file.
 *
 * It only surfaced because a 2,000-mile trail came back in three kilobytes.
 * A response being suspiciously small is a result worth reading twice.
 */
function geometryQuery(ids: number[]): string {
  return `[out:json][timeout:180];relation(id:${ids.join(",")});out body geom;`;
}

let queriesMade = 0;
let slotWaitsMs = 0;

/**
 * Wait until the server says it will take another query.
 *
 * Overpass runs a slot system -- two concurrent queries per client on the
 * main instance -- and publishes the state at /api/status, including how
 * many seconds until the next slot frees. The first version of this importer
 * ignored that and fired on a timer, which exhausted the budget, turned
 * every subsequent query into a refusal, and then paid a blind 20-75 second
 * penalty for each one. It managed two tiles of thirty-six in twenty-six
 * minutes.
 *
 * Asking is both faster and better manners: the server is telling us exactly
 * when it is ready, and there is no reason to guess instead.
 */
async function waitForSlot(mirror: string): Promise<void> {
  const origin = mirror.replace(/\/api\/interpreter$/, "");
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch(`${origin}/api/status`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return;

    const text = await response.text();
    if (/\bslots? available now/i.test(text)) return;

    // "Slot available after: <time>, in 31 seconds." -- possibly several,
    // one per slot. The soonest is the one worth waiting for.
    const waits = [...text.matchAll(/in (\d+) seconds/g)].map((m) => Number(m[1]));
    if (waits.length > 0) {
      const seconds = Math.min(...waits);
      if (Number.isFinite(seconds) && seconds > 0) {
        const ms = Math.min(seconds + 2, 180) * 1000;
        slotWaitsMs += ms;
        console.log(`  waiting ${Math.round(ms / 1000)}s for a slot`);
        await sleep(ms);
      }
    }
  } catch {
    // The status endpoint is advisory. If it is unreachable, carry on and
    // let the request itself tell us.
  }
}

/** One Overpass request. Null means refused or unreachable, not empty. */
async function ask(overpassQl: string, mirror: string): Promise<Relation[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(mirror, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        // Overpass asks that automated clients identify themselves.
        "user-agent": "trailcast-importer (github.com/jacksonhodges4507-crypto/trailcast)",
      },
      body: `data=${encodeURIComponent(overpassQl)}`,
    });
    queriesMade += 1;
    if (!response.ok) return null;
    const body = (await response.json()) as { elements?: Relation[] };
    return body.elements ?? [];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function quarter(box: Box): Box[] {
  const midLat = (box.south + box.north) / 2;
  const midLon = (box.west + box.east) / 2;
  return [
    { south: box.south, west: box.west, north: midLat, east: midLon },
    { south: box.south, west: midLon, north: midLat, east: box.east },
    { south: midLat, west: box.west, north: box.north, east: midLon },
    { south: midLat, west: midLon, north: box.north, east: box.east },
  ];
}

/**
 * Ask a mirror for something, patiently.
 *
 * Null means every attempt was refused. The caller decides whether that is
 * worth splitting up or worth skipping -- the distinction matters, because
 * the two failures here have opposite cures.
 */
async function fetchWithRetry(body: string, label: string): Promise<Relation[] | null> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const mirror = MIRRORS[(requestsStarted + attempt) % MIRRORS.length]!;
    await waitForSlot(mirror);
    requestsStarted += 1;

    const elements = await ask(body, mirror);
    if (elements !== null) {
      await sleep(POLITE_MS);
      return elements;
    }
    const pause = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
    console.log(`  ${label} refused; waiting ${pause / 1000}s`);
    await sleep(pause);
  }
  return null;
}

/**
 * Geometry for a set of relations, a few at a time.
 *
 * This exists because of one measurement. The tile covering Kanab kept being
 * refused while the server reported free slots, so it was never rate
 * limiting -- it was the query being genuinely too expensive. Asking that
 * tile for tags alone answered in eleven seconds and explained itself: the
 * Arizona Trail, the Great Western Trail and two sections of the Hayduke,
 * each hundreds of miles of geometry, all inside the box.
 *
 * The importer was downloading every one of them and then discarding them
 * for being over the 60-mile cap. So geometry is now fetched only for routes
 * that might survive that cap, in small batches, and a batch that fails is
 * halved until the offender is alone and can be skipped by itself. One
 * monster costs one wasted request instead of poisoning a sixth of the
 * state.
 */
async function geometryFor(ids: number[], depth = 0): Promise<Relation[]> {
  if (ids.length === 0) return [];

  const found = await fetchWithRetry(geometryQuery(ids), `geometry x${ids.length}`);
  if (found !== null) return found;

  if (ids.length === 1) {
    console.warn(`  !! skipping relation ${ids[0]}: too large to fetch`);
    skippedRelations += 1;
    return [];
  }

  const half = Math.ceil(ids.length / 2);
  const left = await geometryFor(ids.slice(0, half), depth + 1);
  const right = await geometryFor(ids.slice(half), depth + 1);
  return [...left, ...right];
}

/**
 * Networks that are long-distance by definition. An international or
 * national walking route is never a day out, and it is never under the
 * distance cap, so there is no reason to pay for its geometry to find out.
 */
const THROUGH_NETWORKS = new Set(["iwn", "nwn"]);

/** Every candidate route relation in a tile, listed cheaply. */
async function listTile(box: Box, span: number): Promise<Relation[]> {
  const label = `tile ${box.south},${box.west}`;
  const listed = await fetchWithRetry(listQuery(box), label);
  if (listed !== null) return listed;

  if (span / 2 < MIN_TILE_DEGREES) {
    console.warn(`  !! giving up on ${label} (${span}deg)`);
    failedTiles += 1;
    return [];
  }

  console.log(`  splitting ${label}`);
  const out: Relation[] = [];
  for (const sub of quarter(box)) out.push(...(await listTile(sub, span / 2)));
  return out;
}

let failedTiles = 0;
let requestsStarted = 0;
let skippedRelations = 0;

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

async function main() {
  const tiles: Box[] = [];
  for (let lat = STATE.south; lat < STATE.north; lat += TILE_DEGREES) {
    for (let lon = STATE.west; lon < STATE.east; lon += TILE_DEGREES) {
      tiles.push({
        south: Math.round(lat * 1e4) / 1e4,
        west: Math.round(lon * 1e4) / 1e4,
        north: Math.round(Math.min(lat + TILE_DEGREES, STATE.north) * 1e4) / 1e4,
        east: Math.round(Math.min(lon + TILE_DEGREES, STATE.east) * 1e4) / 1e4,
      });
    }
  }
  console.log(`Walking Utah as ${tiles.length} tiles…`);

  // Pass one: what is out there. Tags only, so this stays cheap and does not
  // choke on the through-routes.
  const candidates = new Map<number, Relation>();
  let throughRoutes = 0;
  for (const [index, tile] of tiles.entries()) {
    const listed = await listTile(tile, TILE_DEGREES);
    let kept = 0;
    for (const relation of listed) {
      const tags = relation.tags ?? {};
      const name = clean(tags["name"] ?? "");
      if (!name || name.length > 60) continue;
      if (THROUGH_NETWORKS.has(tags["network"] ?? "")) {
        throughRoutes += 1;
        continue;
      }
      if (/^(US|UT|SR|I)[- ]?\d/i.test(name)) continue;
      if (tags["route"] === "bicycle" && !TRAILISH.test(name)) continue;
      // Routes straddle tile borders and come back from each; id dedupes.
      candidates.set(relation.id, relation);
      kept += 1;
    }
    console.log(`tile ${index + 1}/${tiles.length} → ${kept} candidates, ${candidates.size} total`);
  }

  if (candidates.size === 0) {
    throw new Error(
      `Overpass listed nothing across ${tiles.length} tiles and ${queriesMade} queries. ` +
        "Refusing to overwrite the snapshot with an empty one.",
    );
  }
  console.log(
    `${candidates.size} candidates (${throughRoutes} through-routes skipped unfetched). ` +
      "Fetching geometry…",
  );

  // Pass two: geometry, only for what might survive the distance cap.
  const ids = [...candidates.keys()];
  const seen = new Map<number, Relation>();
  let checkedFirstBatch = false;
  for (let i = 0; i < ids.length; i += GEOMETRY_BATCH) {
    const batch = ids.slice(i, i + GEOMETRY_BATCH);
    const got = await geometryFor(batch);
    for (const relation of got) seen.set(relation.id, relation);

    // Fail on the first batch, not after walking the whole state. A wrong
    // `out` spec returns 200, returns every relation, returns their names,
    // and returns no coordinates at all -- which looks like success right up
    // until the file is empty an hour later.
    if (!checkedFirstBatch && got.length > 0) {
      checkedFirstBatch = true;
      const withGeometry = got.filter((relation) =>
        (relation.members ?? []).some((m) => m.geometry && m.geometry.length > 1),
      );
      if (withGeometry.length === 0) {
        throw new Error(
          `Fetched ${got.length} relations and not one carried geometry. ` +
            "The Overpass `out` spec is wrong -- it needs `out body geom`, since " +
            "`out tags` returns no members.",
        );
      }
    }

    console.log(`geometry ${Math.min(i + GEOMETRY_BATCH, ids.length)}/${ids.length}`);
  }

  if (seen.size === 0) {
    throw new Error("Listed routes but could fetch no geometry. Refusing to write an empty snapshot.");
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
  const built: Built[] = [];

  for (const relation of seen.values()) {
    const tags = relation.tags ?? {};
    const name = clean(tags["name"] ?? "");
    if (!name || name.length > 60) continue;
    if (/^(US|UT|SR|I)[- ]?\d/i.test(name)) continue;
    if (tags["route"] === "bicycle" && !TRAILISH.test(name)) continue;

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
    const start = flat[0]!;
    // Tiles overlap the state border; keep only what is actually in Utah.
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
    await sleep(250);
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
  console.log(
    `Wrote ${rows.length} trails from ${seen.size} relations ` +
      `(${queriesMade} queries, ${Math.round(slotWaitsMs / 1000)}s waiting for slots, ` +
      `${skippedRelations} relations too large to fetch).`,
  );
  if (failedTiles > 0) console.warn(`${failedTiles} tiles could not be read.`);
}

void main();
