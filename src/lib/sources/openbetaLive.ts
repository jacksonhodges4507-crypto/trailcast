import { withCache } from "../cache";
import { OPENBETA_IDS } from "../data/openbetaIds";
import { getTrail } from "../trails";
import { haversineMi } from "../geo";

/**
 * Live route data from OpenBeta, an open climbing database.
 *
 * The catalogue of areas is imported once (see data/climbingAreas.ts), but
 * the routes and walls inside each area are fetched on demand and cached for
 * a day. Routes change -- new lines go up, grades get revised -- and a copy
 * frozen into the bundle would quietly drift, besides adding thousands of
 * route names to a page that shows one area at a time.
 */

const ENDPOINT = "https://api.openbeta.io/";
const DAY = 86_400;

/** One route: [name, grade, type code, length in metres (0 = unknown), wall index, OpenBeta id]. */
export type RouteRow = [string, string, string, number, number, string];

export interface Wall {
  n: string;
  /** OpenBeta area id, for linking to its page. */
  u?: string;
  lat: number;
  lng: number;
  /** Routes recorded on this wall. */
  c: number;
}

export interface ClimbData {
  walls: Wall[];
  routes: RouteRow[];
  total: number;
  source: string;
}

/** The largest route list sent for one area; the UI shows the true total. */
export const ROUTE_CAP = 600;

interface RawClimb {
  uuid?: string;
  name?: string;
  grades?: { yds?: string | null; vscale?: string | null } | null;
  type?: Record<string, boolean | null> | null;
  length?: number | null;
}

interface RawArea {
  uuid?: string;
  areaName?: string;
  totalClimbs?: number;
  metadata?: { lat?: number | null; lng?: number | null; leaf?: boolean | null } | null;
  climbs?: RawClimb[] | null;
  children?: RawArea[] | null;
}

/** Four levels covers every Utah area in the catalogue down to its walls. */
function nested(fields: string, depth: number): string {
  return depth === 0 ? fields : `${fields} children { ${nested(fields, depth - 1)} }`;
}

const WALL_FIELDS = "uuid areaName totalClimbs metadata { lat lng leaf }";
const CLIMB_FIELDS = `${WALL_FIELDS} climbs { uuid name grades { yds vscale } type { sport trad bouldering tr aid ice mixed alpine } length }`;

async function query(fields: string, uuid: string, depth = 4, timeoutMs = 15_000): Promise<RawArea> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "TrailCast (portfolio project)" },
    body: JSON.stringify({
      query: `query($u: ID) { area(uuid: $u) { ${nested(fields, depth)} } }`,
      variables: { u: uuid },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`OpenBeta answered ${response.status}`);
  const body = (await response.json()) as { data?: { area?: RawArea | null }; errors?: unknown };
  const area = body.data?.area;
  if (!area) throw new Error("OpenBeta returned no area");
  return area;
}

function typeCode(type: RawClimb["type"]): string {
  if (!type) return "";
  if (type["bouldering"]) return "B";
  if (type["sport"]) return "S";
  if (type["trad"]) return "T";
  if (type["tr"]) return "TR";
  if (type["aid"]) return "A";
  if (type["ice"]) return "I";
  if (type["alpine"]) return "AL";
  return "";
}

/** Walk the tree and keep every area that holds routes and has a location. */
export function collectWalls(root: RawArea): { wall: Wall; climbs: RawClimb[] }[] {
  const out: { wall: Wall; climbs: RawClimb[] }[] = [];
  const walk = (area: RawArea) => {
    const climbs = area.climbs ?? [];
    const lat = area.metadata?.lat;
    const lng = area.metadata?.lng;
    const isLeaf = area.metadata?.leaf === true || (area.children ?? []).length === 0;
    const count = climbs.length > 0 ? climbs.length : isLeaf ? area.totalClimbs ?? 0 : 0;
    if (count > 0 && typeof lat === "number" && typeof lng === "number" && (lat !== 0 || lng !== 0)) {
      out.push({
        wall: { n: (area.areaName ?? "").trim(), u: area.uuid, lat: round(lat), lng: round(lng), c: count },
        climbs,
      });
    }
    for (const child of area.children ?? []) walk(child);
  };
  walk(root);
  return out;
}

/*
 * A few OpenBeta walls carry a misplaced pin (one "Ibex" boulder sits in
 * downtown Salt Lake). Anything implausibly far from its own area is dropped
 * rather than drawn somewhere wrong.
 */
const MAX_WALL_MI = 25;

function nearby<T extends { wall: Wall }>(trailId: string, items: T[]): T[] {
  const trail = getTrail(trailId);
  if (!trail) return items;
  return items.filter((item) => haversineMi(trail, { lat: item.wall.lat, lon: item.wall.lng }) <= MAX_WALL_MI);
}

function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

export function hasClimbData(trailId: string): boolean {
  return trailId in OPENBETA_IDS;
}

/** Walls only -- light enough to draw every visible area on the map. */
export async function wallsFor(trailId: string): Promise<Wall[]> {
  const uuid = OPENBETA_IDS[trailId];
  if (!uuid) return [];
  const { value } = await withCache(`ob-walls:${uuid}`, { ttlSeconds: DAY, staleSeconds: 7 * DAY }, async () =>
    nearby(trailId, collectWalls(await query(WALL_FIELDS, uuid))).map((w) => w.wall),
  );
  return value;
}

/** Walls and their routes, for the area someone has opened. */
/*
 * Big areas are fetched in pieces. Asking OpenBeta for Little Cottonwood
 * Canyon's whole tree -- nearly two thousand routes -- in one query took
 * longer than the timeout, so the route list came back "unavailable" for
 * exactly the areas people most want it for. The top level is fetched
 * first, then each sub-area separately and a few at a time; a sub-area that
 * fails is skipped rather than failing the whole list.
 */
async function climbTree(uuid: string): Promise<{ root: RawArea; complete: boolean }> {
  const root = await query(`${CLIMB_FIELDS} children { uuid totalClimbs }`, uuid, 0, 15_000);
  const children = (root.children ?? [])
    .filter((c): c is RawArea & { uuid: string } => typeof c.uuid === "string" && (c.totalClimbs ?? 0) > 0)
    .sort((a, b) => (b.totalClimbs ?? 0) - (a.totalClimbs ?? 0));

  const loaded: RawArea[] = [];
  let complete = true;
  const queue = [...children];
  const worker = async () => {
    for (let child = queue.shift(); child; child = queue.shift()) {
      try {
        loaded.push(await query(CLIMB_FIELDS, child.uuid, 3, 20_000));
      } catch {
        complete = false;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, children.length) }, worker));

  // Keep the busiest sub-areas first, as OpenBeta ranks them.
  const order = new Map(children.map((c, i) => [c.uuid, i]));
  loaded.sort((a, b) => (order.get(a.uuid ?? "") ?? 0) - (order.get(b.uuid ?? "") ?? 0));
  return { root: { ...root, children: loaded }, complete };
}

/** Walls and their routes, for the area someone has opened. */
export async function climbsFor(trailId: string): Promise<ClimbData | null> {
  const uuid = OPENBETA_IDS[trailId];
  if (!uuid) return null;
  const { value } = await withCache(`ob-climbs:${uuid}`, { ttlSeconds: DAY, staleSeconds: 7 * DAY }, async () => {
    const { root, complete } = await climbTree(uuid);
    const walls = nearby(trailId, collectWalls(root)).filter((w) => w.climbs.length > 0);
    if (walls.length === 0 && !complete) throw new Error("OpenBeta sub-areas did not load");
    const routes: RouteRow[] = [];
    walls.forEach((w, index) => {
      for (const climb of w.climbs) {
        const grade = climb.grades?.yds || climb.grades?.vscale || "";
        const metres = typeof climb.length === "number" && climb.length > 0 ? Math.round(climb.length) : 0;
        routes.push([(climb.name ?? "").trim(), grade, typeCode(climb.type), metres, index, climb.uuid ?? ""]);
      }
    });
    return {
      walls: walls.map((w) => w.wall),
      routes: routes.slice(0, ROUTE_CAP),
      total: Math.max(routes.length, root.totalClimbs ?? 0),
      source: complete ? "live, refreshed daily" : "live; a few sub-areas did not load this time",
    } satisfies ClimbData;
  });
  return value;
}
