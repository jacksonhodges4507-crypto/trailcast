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

/** One route: [name, grade, type code, length in metres (0 = unknown), wall index]. */
export type RouteRow = [string, string, string, number, number];

export interface Wall {
  n: string;
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
  name?: string;
  grades?: { yds?: string | null; vscale?: string | null } | null;
  type?: Record<string, boolean | null> | null;
  length?: number | null;
}

interface RawArea {
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

const WALL_FIELDS = "areaName totalClimbs metadata { lat lng leaf }";
const CLIMB_FIELDS = `${WALL_FIELDS} climbs { name grades { yds vscale } type { sport trad bouldering tr aid ice mixed alpine } length }`;

async function query(fields: string, uuid: string, signal?: AbortSignal): Promise<RawArea> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "TrailCast (portfolio project)" },
    body: JSON.stringify({
      query: `query($u: ID) { area(uuid: $u) { ${nested(fields, 4)} } }`,
      variables: { u: uuid },
    }),
    signal: signal ?? AbortSignal.timeout(15_000),
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
        wall: { n: (area.areaName ?? "").trim(), lat: round(lat), lng: round(lng), c: count },
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
export async function climbsFor(trailId: string): Promise<ClimbData | null> {
  const uuid = OPENBETA_IDS[trailId];
  if (!uuid) return null;
  const { value } = await withCache(`ob-climbs:${uuid}`, { ttlSeconds: DAY, staleSeconds: 7 * DAY }, async () => {
    const walls = nearby(trailId, collectWalls(await query(CLIMB_FIELDS, uuid))).filter((w) => w.climbs.length > 0);
    const routes: RouteRow[] = [];
    walls.forEach((w, index) => {
      for (const climb of w.climbs) {
        const grade = climb.grades?.yds || climb.grades?.vscale || "";
        const metres = typeof climb.length === "number" && climb.length > 0 ? Math.round(climb.length) : 0;
        routes.push([(climb.name ?? "").trim(), grade, typeCode(climb.type), metres, index]);
      }
    });
    return {
      walls: walls.map((w) => w.wall),
      routes: routes.slice(0, ROUTE_CAP),
      total: routes.length,
      source: "live, refreshed daily",
    } satisfies ClimbData;
  });
  return value;
}
