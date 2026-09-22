import { OSM_LINES } from "../data/osmLines";
import { getTrail } from "../trails";
import { haversineMi } from "../geo";

/**
 * The shape of each place, from OpenStreetMap: the trail itself for hiking,
 * running and riding, the fishable stretch for rivers, and the shoreline for
 * lakes.
 *
 * Each place names the OSM features to look for near its point. Matching by
 * name inside a radius is deliberate: a bare radius query around a trailhead
 * returns every social trail and service road in the canyon, which drew a
 * scribble rather than a route.
 */

type Kind = "trail" | "river" | "lake";

interface Spec {
  kind: Kind;
  /** Search radius around the place's point, metres. */
  radius: number;
  /** Case-insensitive pattern for the OSM `name` tag. */
  name: string;
}

export const OSM_SPECS: Record<string, Spec> = {
  "timpanogos-timpooneke": { kind: "trail", radius: 6000, name: "Timpooneke|Timpanogos (Summit )?Trail|Mount Timpanogos Trail" },
  "y-mountain": { kind: "trail", radius: 2500, name: "^Y Trail|Y Mountain" },
  "stewart-falls": { kind: "trail", radius: 3000, name: "Stewart Falls" },
  "lake-blanche": { kind: "trail", radius: 4500, name: "Lake Blanche" },
  "donut-falls": { kind: "trail", radius: 2500, name: "Donut Falls" },
  "desolation-lake": { kind: "trail", radius: 6000, name: "Desolation" },
  "wasatch-crest": { kind: "trail", radius: 9000, name: "Wasatch Crest" },
  "corner-canyon": { kind: "trail", radius: 5000, name: "Clark" },
  "bonneville-shoreline-slc": { kind: "trail", radius: 4500, name: "Bonneville Shoreline" },
  "mount-olympus": { kind: "trail", radius: 5000, name: "Olympus" },
  "red-pine-lake": { kind: "trail", radius: 5000, name: "Red Pine" },
  "bells-canyon": { kind: "trail", radius: 3500, name: "Bells? Canyon" },
  "slickrock-moab": { kind: "trail", radius: 7000, name: "Slickrock" },
  "delicate-arch": { kind: "trail", radius: 3000, name: "Delicate Arch" },
  "angels-landing": { kind: "trail", radius: 4000, name: "Angels Landing|West Rim" },
  "provo-river-middle": { kind: "river", radius: 5000, name: "^Provo River$" },
  "provo-river-lower": { kind: "river", radius: 4500, name: "^Provo River$" },
  "weber-river": { kind: "river", radius: 4500, name: "^Weber River$" },
  "green-river-a-section": { kind: "river", radius: 9000, name: "^Green River$" },
  "logan-river": { kind: "river", radius: 4000, name: "^Logan River$" },
  "big-cottonwood-creek": { kind: "river", radius: 3000, name: "Big Cottonwood Creek" },
  "fremont-river": { kind: "river", radius: 4000, name: "^Fremont River$" },
  "strawberry-reservoir": { kind: "lake", radius: 15000, name: "Strawberry Reservoir" },
};

/*
 * Public Overpass instances, tried in order. The main one rate-limits hard
 * under load, and a map overlay is worth a second attempt elsewhere before
 * giving up.
 */
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export type Line = [number, number][];

interface OverpassElement {
  geometry?: { lat: number; lon: number }[];
  members?: { geometry?: { lat: number; lon: number }[] }[];
}

function selector(spec: Spec, lat: number, lon: number): string {
  const name = spec.name.replace(/"/g, "");
  const around = `around:${spec.radius},${lat},${lon}`;
  if (spec.kind === "trail") {
    return `way(${around})[highway~"path|footway|track|bridleway|cycleway"][name~"${name}",i];`;
  }
  if (spec.kind === "river") return `way(${around})[waterway~"river|stream"][name~"${name}",i];`;
  return `(way(${around})[natural=water][name~"${name}",i];relation(${around})[natural=water][name~"${name}",i];);`;
}

/** Douglas-Peucker in degrees; plenty for a line drawn a few pixels wide. */
export function simplify(points: Line, epsilon: number): Line {
  if (points.length < 3) return points;
  const [ax, ay] = points[0]!;
  const [bx, by] = points[points.length - 1]!;
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
    const distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (distance > worst) {
      worst = distance;
      index = i;
    }
  }
  if (worst <= epsilon) return [points[0]!, points[points.length - 1]!];
  return [...simplify(points.slice(0, index + 1), epsilon).slice(0, -1), ...simplify(points.slice(index), epsilon)];
}

/** Turn an Overpass answer into drawable runs, clipped and simplified. */
export function toLines(elements: OverpassElement[], spec: Spec, lat: number, lon: number): Line[] {
  const runs: Line[] = [];
  const epsilon = spec.kind === "lake" ? 0.0008 : 0.00015;
  const radiusMi = spec.radius / 1609.34;

  for (const element of elements) {
    const parts = element.geometry ? [element.geometry] : (element.members ?? []).flatMap((m) => (m.geometry ? [m.geometry] : []));
    for (const part of parts) {
      let run: Line = part.map((p) => [p.lon, p.lat]);
      // A river is hundreds of miles long; keep the stretch this place means.
      if (spec.kind === "river") run = run.filter(([x, y]) => haversineMi({ lat, lon }, { lat: y, lon: x }) <= radiusMi);
      if (run.length < 2) continue;
      runs.push(simplify(run, epsilon).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]));
    }
  }
  return runs;
}

export function hasLines(trailId: string): boolean {
  return trailId in OSM_SPECS;
}

/**
 * Lines are served from a snapshot, not fetched per request. Public Overpass
 * instances refuse or time out requests from cloud IP ranges often enough
 * that a live call from the server left the map bare; trail shapes change on
 * the scale of years, so a snapshot refreshed by `scripts/import-osm-lines.ts`
 * is the right trade.
 */
export function linesFor(trailId: string): Line[] {
  return OSM_LINES[trailId] ?? [];
}

/** Query Overpass for one place. Used by the import script, not at runtime. */
export async function fetchLinesLive(trailId: string): Promise<Line[]> {
  const spec = OSM_SPECS[trailId];
  const trail = getTrail(trailId);
  if (!spec || !trail) return [];

  const body = `data=${encodeURIComponent(`[out:json][timeout:25];${selector(spec, trail.lat, trail.lon)}out geom;`)}`;
  let lastError: unknown = new Error("no mirror answered");
  for (const mirror of MIRRORS) {
    try {
      const response = await fetch(mirror, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "TrailCast (portfolio project)",
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`${mirror} answered ${response.status}`);
      const json = (await response.json()) as { elements?: OverpassElement[] };
      return toLines(json.elements ?? [], spec, trail.lat, trail.lon);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
