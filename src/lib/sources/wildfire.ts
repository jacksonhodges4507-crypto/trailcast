import type { SourceAdapter, SourceContext, SourceResult } from "./types";
import { asRecord, fetchJson } from "./types";
import type { SourceRef, WildfireSummary } from "../types";
import { bboxAround, haversineMi } from "../geo";

/**
 * Current interagency wildfire perimeters, published by NIFC as an open
 * ArcGIS feature service. No key, no quota.
 */
const ENDPOINT =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query";

/** How far away a fire still matters for smoke, closures and detours. */
export const ALERT_RADIUS_MI = 35;

function firstString(
  attrs: Record<string, unknown>,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = attrs[name];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function firstNumber(
  attrs: Record<string, unknown>,
  names: string[],
): number | undefined {
  for (const name of names) {
    const value = attrs[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

/**
 * Rough centroid: the mean of every vertex. Good enough to answer "how far
 * is this fire from the trailhead" to within a mile on perimeters this size,
 * and it avoids pulling in a geometry library for one number.
 */
function centroidOf(geometry: unknown): { lat: number; lon: number } | undefined {
  let sumLat = 0;
  let sumLon = 0;
  let count = 0;

  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (
      node.length >= 2 &&
      typeof node[0] === "number" &&
      typeof node[1] === "number"
    ) {
      sumLon += node[0];
      sumLat += node[1];
      count += 1;
      return;
    }
    for (const child of node) walk(child);
  };

  const geo = asRecord(geometry);
  if (!geo) return undefined;
  walk(geo["coordinates"]);

  if (count === 0) return undefined;
  return { lat: sumLat / count, lon: sumLon / count };
}

export const wildfireAdapter: SourceAdapter = {
  id: "nifc-wfigs",
  name: "NIFC WFIGS Perimeters",
  attribution: "Wildfire perimeters courtesy of NIFC / WFIGS (public domain)",
  homepage: "https://data-nifc.opendata.arcgis.com/",
  ttlSeconds: 60 * 60,
  staleSeconds: 12 * 60 * 60,

  async fetch({ point, dates, signal }: SourceContext): Promise<SourceResult> {
    const box = bboxAround(point, ALERT_RADIUS_MI);
    const params = new URLSearchParams({
      where: "1=1",
      geometry: `${box.minLon},${box.minLat},${box.maxLon},${box.maxLat}`,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "*",
      returnGeometry: "true",
      outSR: "4326",
      resultRecordCount: "25",
      f: "geojson",
    });
    const url = `${ENDPOINT}?${params.toString()}`;

    const payload = asRecord(await fetchJson(url, 9000, signal));
    if (!payload) throw new Error("WFIGS returned a non-object payload");

    const features = Array.isArray(payload["features"]) ? payload["features"] : [];
    const fires: WildfireSummary[] = [];

    for (const raw of features) {
      const feature = asRecord(raw);
      if (!feature) continue;

      const attrs = asRecord(feature["properties"]) ?? {};
      const centre = centroidOf(feature["geometry"]);
      if (!centre) continue;

      const distanceMi = haversineMi(point, centre);
      if (distanceMi > ALERT_RADIUS_MI) continue;

      const name =
        firstString(attrs, [
          "poly_IncidentName",
          "attr_IncidentName",
          "IncidentName",
          "incident_name",
        ]) ?? "Unnamed incident";

      const acres = firstNumber(attrs, [
        "poly_GISAcres",
        "attr_IncidentSize",
        "GISAcres",
        "gis_acres",
      ]);

      const discoveredRaw = firstNumber(attrs, [
        "attr_FireDiscoveryDateTime",
        "poly_DateCurrent",
      ]);
      const discoveredAt =
        discoveredRaw !== undefined && discoveredRaw > 0
          ? new Date(discoveredRaw).toISOString()
          : firstString(attrs, ["attr_FireDiscoveryDateTime"]);

      fires.push({
        name,
        distanceMi: Math.round(distanceMi * 10) / 10,
        acres: acres !== undefined ? Math.round(acres) : undefined,
        discoveredAt,
      });
    }

    fires.sort((a, b) => a.distanceMi - b.distanceMi);

    const fetchedAt = new Date().toISOString();
    const ref: SourceRef = {
      sourceId: wildfireAdapter.id,
      sourceName: wildfireAdapter.name,
      url,
      attribution: wildfireAdapter.attribution,
      fetchedAt,
      field: `perimeters within ${ALERT_RADIUS_MI} mi`,
    };

    const values: SourceResult["values"] = {};
    const refs: SourceResult["refs"] = {};
    const extras: Record<string, unknown> = {};

    // The fire picture is the same for every date in the window: these are
    // current perimeters, not a forecast. Attaching per-date keeps the
    // downstream shape uniform.
    for (const date of dates) {
      values[`${date}:wildfireCount`] = fires.length;
      refs[`${date}:wildfireCount`] = ref;
      extras[`${date}:wildfires`] = fires;
    }

    return { values, refs, extras };
  },
};
