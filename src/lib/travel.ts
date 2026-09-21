import { withCache } from "./cache";
import { haversineMi, type LatLon } from "./geo";
import type { Trail, Travel } from "./types";

/**
 * Drive times from the user's location to each area.
 *
 * Uses the OSRM table service, which answers "how long from here to each of
 * these forty places" in a single request -- one call per page load rather
 * than forty. OSRM's public server asks for light use, a real User-Agent and
 * visible attribution, so results are cached per rounded origin and the UI
 * credits it.
 *
 * Times are free-flow: no traffic, no chain controls, no closed passes. They
 * are labelled that way rather than presented as a promise.
 */

const OSRM = "https://router.project-osrm.org/table/v1/driving";

/** OSRM's public server rejects very long coordinate lists. */
const MAX_DESTINATIONS = 90;

/**
 * Round an origin before it leaves the browser or enters a cache key.
 *
 * Two decimal places is about a kilometre: plenty for a drive-time estimate,
 * and far coarser than a precise home location. Nothing finer is ever sent
 * to a third party, stored, or logged.
 */
export function coarsen(point: LatLon): LatLon {
  return {
    lat: Math.round(point.lat * 100) / 100,
    lon: Math.round(point.lon * 100) / 100,
  };
}

/** Straight-line distance times a road factor, at a mountain-road average. */
const ROAD_FACTOR = 1.35;
const AVERAGE_MPH = 45;

export function estimateTravel(origin: LatLon, trail: LatLon): Travel {
  const roadMiles = haversineMi(origin, trail) * ROAD_FACTOR;
  return {
    minutes: Math.round((roadMiles / AVERAGE_MPH) * 60),
    miles: Math.round(roadMiles),
    source: "estimate",
  };
}

async function osrmTable(origin: LatLon, trails: Trail[], signal?: AbortSignal): Promise<Travel[]> {
  const coords = [origin, ...trails]
    .map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`)
    .join(";");

  const url = `${OSRM}/${coords}?sources=0&annotations=duration,distance`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "trailcast/0.1 (portfolio project)" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`OSRM answered ${response.status}`);

    const body = (await response.json()) as {
      code?: string;
      durations?: (number | null)[][];
      distances?: (number | null)[][];
    };
    if (body.code !== "Ok") throw new Error(`OSRM returned ${body.code ?? "no code"}`);

    const durations = body.durations?.[0] ?? [];
    const distances = body.distances?.[0] ?? [];

    // Index 0 is the origin itself; destinations start at 1.
    return trails.map((trail, i) => {
      const seconds = durations[i + 1];
      const metres = distances[i + 1];
      // An unroutable destination -- no road reaches it -- falls back to an
      // estimate rather than silently vanishing from the ranking.
      if (typeof seconds !== "number" || typeof metres !== "number") {
        return estimateTravel(origin, trail);
      }
      return {
        minutes: Math.round(seconds / 60),
        miles: Math.round(metres / 1609.34),
        source: "osrm" as const,
      };
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Drive times for a set of areas, keyed by trail id.
 *
 * Never throws. If routing is unavailable, every value degrades to a labelled
 * straight-line estimate, so the ranking still accounts for distance and the
 * UI can say the figures are approximate.
 */
export async function travelTimes(
  origin: LatLon,
  trails: Trail[],
  signal?: AbortSignal,
): Promise<Map<string, Travel>> {
  const from = coarsen(origin);
  const result = new Map<string, Travel>();
  if (trails.length === 0) return result;

  const batch = trails.slice(0, MAX_DESTINATIONS);
  const cacheKey = `osrm|${from.lat},${from.lon}|${batch.map((t) => t.id).join(",")}`;

  let times: Travel[];
  try {
    const cached = await withCache(cacheKey, { ttlSeconds: 6 * 60 * 60, staleSeconds: 24 * 60 * 60 }, () =>
      osrmTable(from, batch, signal),
    );
    times = cached.value;
  } catch {
    times = batch.map((trail) => estimateTravel(from, trail));
  }

  batch.forEach((trail, i) => {
    const time = times[i];
    if (time) result.set(trail.id, time);
  });

  for (const trail of trails.slice(MAX_DESTINATIONS)) {
    result.set(trail.id, estimateTravel(from, trail));
  }

  return result;
}

/**
 * How much a drive costs, in score points, when choosing between places.
 *
 * The first half hour is free -- nearly everything is at least that far.
 * After that, each hour of one-way driving costs six points. Six is a
 * judgement rather than a measurement, and it is deliberately modest: it
 * means a place has to be about six points better to justify an extra hour
 * each way, which matches how most people actually choose, and it is small
 * enough that a genuinely great day still wins over a mediocre close one.
 *
 * This never touches the conditions score itself. How good a crag is today
 * is a fact about the crag; whether it is worth the drive is a fact about
 * you. Keeping them separate means the map shows the same score to everyone.
 */
export const FREE_MINUTES = 30;
export const POINTS_PER_HOUR = 6;

export function drivePenalty(minutes: number): number {
  return (Math.max(0, minutes - FREE_MINUTES) / 60) * POINTS_PER_HOUR;
}
