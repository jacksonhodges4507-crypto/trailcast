import type { Conditions, HourPoint, SourceRef, WildfireSummary } from "./types";
import type { GatherResult } from "./sources";

function num(values: GatherResult["values"], date: string, field: string): number | undefined {
  const value = values[`${date}:${field}`];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(values: GatherResult["values"], date: string, field: string): string | undefined {
  const value = values[`${date}:${field}`];
  return typeof value === "string" ? value : undefined;
}

/**
 * Collapse the flat `${date}:${field}` bag returned by the source layer into
 * the shape the scoring engine reads, carrying every provenance record along
 * with it. Fields with no data stay `undefined` rather than defaulting to a
 * number, so a rule can tell "zero" from "we don't know".
 */
export function assembleConditions(gathered: GatherResult, date: string): Conditions {
  const { values, refs, extras } = gathered;

  const fields = [
    "tempMaxF",
    "tempMinF",
    "tempAtStartF",
    "precipitationIn",
    "precipitationChancePct",
    "precipitationPrior72hIn",
    "hoursSincePrecip",
    "cloudCoverPct",
    "pressureHpa",
    "pressureChangeHpa",
    "waterTempF",
    "streamflowCfs",
    "gaugeDistanceMi",
    "gaugeId",
    "windMph",
    "windGustMph",
    "snowDepthIn",
    "usAqi",
    "pm25",
    "daylightHours",
    "sunriseLocal",
    "sunsetLocal",
  ] as const;

  const carried: Record<string, SourceRef> = {};
  for (const field of fields) {
    const ref = refs[`${date}:${field}`];
    if (ref) carried[field] = ref;
  }

  const wildfireRef = refs[`${date}:wildfireCount`];
  if (wildfireRef) carried["wildfires"] = wildfireRef;

  const rawFires = extras[`${date}:wildfires`];
  const wildfires = Array.isArray(rawFires) ? (rawFires as WildfireSummary[]) : undefined;

  const rawHours = extras[`${date}:hours`];
  const hours = Array.isArray(rawHours) ? (rawHours as HourPoint[]) : undefined;
  const hoursRef = refs[`${date}:hours`];
  if (hoursRef) carried["hours"] = hoursRef;

  return {
    date,
    hours,
    timezone: str(values, date, "timezone") ?? "UTC",
    tempMaxF: num(values, date, "tempMaxF"),
    tempMinF: num(values, date, "tempMinF"),
    tempAtStartF: num(values, date, "tempAtStartF"),
    precipitationIn: num(values, date, "precipitationIn"),
    precipitationChancePct: num(values, date, "precipitationChancePct"),
    precipitationPrior72hIn: num(values, date, "precipitationPrior72hIn"),
    hoursSincePrecip: num(values, date, "hoursSincePrecip"),
    cloudCoverPct: num(values, date, "cloudCoverPct"),
    pressureHpa: num(values, date, "pressureHpa"),
    pressureChangeHpa: num(values, date, "pressureChangeHpa"),
    waterTempF: num(values, date, "waterTempF"),
    streamflowCfs: num(values, date, "streamflowCfs"),
    gaugeDistanceMi: num(values, date, "gaugeDistanceMi"),
    gaugeId: str(values, date, "gaugeId"),
    windMph: num(values, date, "windMph"),
    windGustMph: num(values, date, "windGustMph"),
    snowDepthIn: num(values, date, "snowDepthIn"),
    usAqi: num(values, date, "usAqi"),
    pm25: num(values, date, "pm25"),
    daylightHours: num(values, date, "daylightHours"),
    sunriseLocal: str(values, date, "sunriseLocal"),
    sunsetLocal: str(values, date, "sunsetLocal"),
    wildfires,
    refs: carried,
  };
}
