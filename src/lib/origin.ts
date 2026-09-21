import { coarsen } from "./travel";
import type { LatLon } from "./geo";

/**
 * Parse a client-supplied origin.
 *
 * Coordinates arrive from the browser, so they are untrusted input: anything
 * non-numeric or out of range is dropped rather than passed to a routing
 * service. Valid values are coarsened to about a kilometre before use, so a
 * precise position is never forwarded, cached or logged.
 */
export function parseOrigin(lat: unknown, lon: unknown): LatLon | undefined {
  const la = typeof lat === "string" ? Number(lat) : lat;
  const lo = typeof lon === "string" ? Number(lon) : lon;

  if (typeof la !== "number" || typeof lo !== "number") return undefined;
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return undefined;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return undefined;

  return coarsen({ lat: la, lon: lo });
}
