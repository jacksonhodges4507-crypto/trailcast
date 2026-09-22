/** Small geodesy helpers. No dependencies; PostGIS would replace these. */

const EARTH_RADIUS_MI = 3958.8;

export interface LatLon {
  lat: number;
  lon: number;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in miles. */
export function haversineMi(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Bounding box padded by `paddingMi` around a point. */
export function bboxAround(point: LatLon, paddingMi: number): {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
} {
  const latDelta = paddingMi / 69;
  const cosLat = Math.cos(toRadians(point.lat));
  // Guard against division by ~0 near the poles.
  const lonDelta = paddingMi / (69 * Math.max(0.01, Math.abs(cosLat)));

  return {
    minLat: point.lat - latDelta,
    minLon: point.lon - lonDelta,
    maxLat: point.lat + latDelta,
    maxLon: point.lon + lonDelta,
  };
}

/** Bounding box that contains every supplied point, padded by `paddingMi`. */
export function bboxOf(points: LatLon[], paddingMi = 0): {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
} | null {
  if (points.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }

  const latPad = paddingMi / 69;
  const lonPad = paddingMi / 55; // conservative at mid-latitudes

  return {
    minLat: minLat - latPad,
    minLon: minLon - lonPad,
    maxLat: maxLat + latPad,
    maxLon: maxLon + lonPad,
  };
}

/**
 * Cluster points onto a coarse grid so that nearby trails share one upstream
 * request. At 0.25 degrees the cells are roughly 17 x 13 miles, comfortably
 * finer than the weather models we read and coarse enough to collapse a
 * canyon full of trailheads into a single fetch.
 */
export const GRID_DEGREES = 0.25;

export function gridKey(point: LatLon): string {
  const lat = Math.round(point.lat / GRID_DEGREES) * GRID_DEGREES;
  const lon = Math.round(point.lon / GRID_DEGREES) * GRID_DEGREES;
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

export function gridCentre(key: string): LatLon {
  const [latStr, lonStr] = key.split(",");
  return { lat: Number(latStr), lon: Number(lonStr) };
}

/** How far a pin may be moved onto its drawn line, in miles. */
export const SNAP_LIMIT_MI = 0.7;

/**
 * Put the pin on the line.
 *
 * A trailhead coordinate and an OpenStreetMap way are two different people's
 * idea of where a trail is: ours is the parking lot, theirs is the first
 * mapped metre of path. A reader sees the gap between them as the map being
 * wrong, so where a place has a drawn line the pin moves to the point on
 * that line nearest the trailhead.
 *
 * The move is capped. Past SNAP_LIMIT_MI the line is not a near-miss, it is
 * the wrong feature, and dragging the pin onto it would turn a visible gap
 * into an invisible error.
 */
export function snapToLines(
  point: LatLon,
  lines: [number, number][][],
): [number, number] {
  let best: [number, number] | null = null;
  let bestMi = SNAP_LIMIT_MI;

  for (const line of lines) {
    for (const [lon, lat] of line) {
      const miles = haversineMi(point, { lat, lon });
      if (miles < bestMi) {
        bestMi = miles;
        best = [lon, lat];
      }
    }
  }

  return best ?? [point.lon, point.lat];
}
