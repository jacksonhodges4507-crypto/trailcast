import type { SourceAdapter, SourceContext, SourceResult } from "./types";
import { asRecord, fetchJson, key } from "./types";
import type { SourceRef } from "../types";
import { bboxAround, haversineMi } from "../geo";

/**
 * Live stream gauge readings from the USGS Water Data OGC API.
 *
 * Worth a note on which endpoint this is. The long-standing
 * `waterservices.usgs.gov/nwis` service now answers 503 -- USGS has been
 * retiring it -- so this uses the current `api.waterdata.usgs.gov` OGC API
 * instead. The older endpoint is the one almost every tutorial still shows,
 * which is a good reminder that "it worked in the example" is not the same as
 * "it works today".
 */
const ENDPOINT =
  "https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items";

/** Discharge, in cubic feet per second. */
const PARAM_DISCHARGE = "00060";
/** Water temperature, in Celsius. */
const PARAM_WATER_TEMP = "00010";

/** How far from a fishery we will accept a gauge before calling it unrelated. */
export const GAUGE_RADIUS_MI = 25;

/** Readings older than this tell you about a different day. */
const MAX_AGE_HOURS = 36;

interface Reading {
  siteId: string;
  value: number;
  unit: string;
  observedAt: string;
  distanceMi: number;
}

function nearestReading(
  payload: Record<string, unknown>,
  point: { lat: number; lon: number },
): Reading | undefined {
  const features = Array.isArray(payload["features"]) ? payload["features"] : [];
  let best: Reading | undefined;

  for (const raw of features) {
    const feature = asRecord(raw);
    const props = asRecord(feature?.["properties"]);
    const geometry = asRecord(feature?.["geometry"]);
    if (!props || !geometry) continue;

    const coords = geometry["coordinates"];
    if (!Array.isArray(coords) || typeof coords[0] !== "number" || typeof coords[1] !== "number") {
      continue;
    }

    // `value` arrives as a string, and is null on offline gauges.
    const rawValue = props["value"];
    const value = typeof rawValue === "string" ? Number(rawValue) : rawValue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;

    const distanceMi = haversineMi(point, { lat: coords[1], lon: coords[0] });
    if (distanceMi > GAUGE_RADIUS_MI) continue;
    if (best && distanceMi >= best.distanceMi) continue;

    best = {
      siteId: typeof props["monitoring_location_id"] === "string"
        ? props["monitoring_location_id"]
        : "unknown gauge",
      value,
      unit: typeof props["unit_of_measure"] === "string" ? props["unit_of_measure"] : "",
      observedAt: typeof props["time"] === "string" ? props["time"] : "",
      distanceMi,
    };
  }

  return best;
}

function buildUrl(
  point: { lat: number; lon: number },
  parameterCode: string,
  since: string,
): string {
  const box = bboxAround(point, GAUGE_RADIUS_MI);
  const params = new URLSearchParams({
    f: "json",
    limit: "40",
    parameter_code: parameterCode,
    datetime: `${since}/..`,
    bbox: `${box.minLon.toFixed(4)},${box.minLat.toFixed(4)},${box.maxLon.toFixed(4)},${box.maxLat.toFixed(4)}`,
  });
  return `${ENDPOINT}?${params.toString()}`;
}

export const usgsWaterAdapter: SourceAdapter = {
  id: "usgs-water",
  name: "USGS Water Data",
  attribution: "Stream gauge data courtesy of the U.S. Geological Survey (public domain)",
  homepage: "https://waterdata.usgs.gov/",
  ttlSeconds: 20 * 60,
  staleSeconds: 6 * 60 * 60,

  async fetch({ point, dates, signal }: SourceContext): Promise<SourceResult> {
    const since = new Date(Date.now() - MAX_AGE_HOURS * 3_600_000)
      .toISOString()
      .slice(0, 19) + "Z";

    const flowUrl = buildUrl(point, PARAM_DISCHARGE, since);
    const tempUrl = buildUrl(point, PARAM_WATER_TEMP, since);

    // One dead parameter should not cost us the other.
    const [flowPayload, tempPayload] = await Promise.all([
      fetchJson(flowUrl, 9000, signal).then(asRecord).catch(() => undefined),
      fetchJson(tempUrl, 9000, signal).then(asRecord).catch(() => undefined),
    ]);

    if (!flowPayload && !tempPayload) {
      throw new Error("USGS returned nothing usable for either parameter");
    }

    const flow = flowPayload ? nearestReading(flowPayload, point) : undefined;
    const temp = tempPayload ? nearestReading(tempPayload, point) : undefined;

    const fetchedAt = new Date().toISOString();
    const values: SourceResult["values"] = {};
    const refs: SourceResult["refs"] = {};

    const makeRef = (url: string, field: string): SourceRef => ({
      sourceId: usgsWaterAdapter.id,
      sourceName: usgsWaterAdapter.name,
      url,
      attribution: usgsWaterAdapter.attribution,
      fetchedAt,
      field,
    });

    for (const date of dates) {
      if (flow) {
        values[key(date, "streamflowCfs")] = flow.value;
        values[key(date, "gaugeDistanceMi")] = Math.round(flow.distanceMi * 10) / 10;
        values[key(date, "gaugeId")] = flow.siteId;
        refs[key(date, "streamflowCfs")] = makeRef(flowUrl, `discharge at ${flow.siteId}`);
        refs[key(date, "gaugeId")] = makeRef(flowUrl, `gauge ${flow.siteId}`);
      }

      if (temp) {
        // USGS reports water temperature in Celsius.
        values[key(date, "waterTempF")] = temp.value * 1.8 + 32;
        refs[key(date, "waterTempF")] = makeRef(tempUrl, `water temperature at ${temp.siteId}`);
      }
    }

    return { values, refs };
  },
};
