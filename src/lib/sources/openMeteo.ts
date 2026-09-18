import type { SourceAdapter, SourceContext, SourceResult } from "./types";
import { asNumberArray, asRecord, asStringArray, fetchJson, key } from "./types";
import type { SourceRef } from "../types";

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

const HOURLY = [
  "temperature_2m",
  "precipitation",
  "precipitation_probability",
  "wind_speed_10m",
  "wind_gusts_10m",
  "snow_depth",
] as const;

const DAILY = [
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "sunrise",
  "sunset",
  "daylight_duration",
] as const;

function buildUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: HOURLY.join(","),
    daily: DAILY.join(","),
    timezone: "auto",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    past_days: "3",
    forecast_days: "7",
  });
  return `${ENDPOINT}?${params.toString()}`;
}

/**
 * Length values arrive in whatever unit the model reports. Rather than
 * assume, read the units block and convert. `snow_depth` in particular is
 * metres by default even when precipitation is requested in inches.
 */
function toInches(value: number, unit: string | undefined): number {
  switch ((unit ?? "").trim()) {
    case "m":
      return value * 39.3701;
    case "cm":
      return value * 0.393701;
    case "mm":
      return value * 0.0393701;
    case "ft":
      return value * 12;
    case "inch":
    case "in":
    default:
      return value;
  }
}

/** Open-Meteo local timestamps look like `2026-09-17T09:00`. */
function dateOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function hourOf(timestamp: string): number {
  return Number(timestamp.slice(11, 13));
}

export const openMeteoAdapter: SourceAdapter = {
  id: "open-meteo",
  name: "Open-Meteo",
  attribution: "Weather data by Open-Meteo.com (CC BY 4.0)",
  homepage: "https://open-meteo.com/",
  ttlSeconds: 15 * 60,
  staleSeconds: 6 * 60 * 60,

  async fetch({ point, dates, signal }: SourceContext): Promise<SourceResult> {
    const url = buildUrl(point.lat, point.lon);
    const payload = asRecord(await fetchJson(url, 8000, signal));
    if (!payload) throw new Error("Open-Meteo returned a non-object payload");

    const fetchedAt = new Date().toISOString();
    const timezone =
      typeof payload["timezone"] === "string" ? payload["timezone"] : "UTC";

    const makeRef = (field: string): SourceRef => ({
      sourceId: openMeteoAdapter.id,
      sourceName: openMeteoAdapter.name,
      url,
      attribution: openMeteoAdapter.attribution,
      fetchedAt,
      field,
    });

    const values: SourceResult["values"] = {};
    const refs: SourceResult["refs"] = {};

    const set = (date: string, field: string, value: number | string | undefined, upstream: string) => {
      if (value === undefined || value === null) return;
      if (typeof value === "number" && !Number.isFinite(value)) return;
      values[key(date, field)] = value;
      refs[key(date, field)] = makeRef(upstream);
    };

    for (const date of dates) set(date, "timezone", timezone, "timezone");

    // ---- daily block -------------------------------------------------
    const daily = asRecord(payload["daily"]);
    const dailyUnits = asRecord(payload["daily_units"]) ?? {};
    const dailyTimes = asStringArray(daily?.["time"]) ?? [];

    const tMax = asNumberArray(daily?.["temperature_2m_max"]);
    const tMin = asNumberArray(daily?.["temperature_2m_min"]);
    const precipSum = asNumberArray(daily?.["precipitation_sum"]);
    const sunrise = asStringArray(daily?.["sunrise"]);
    const sunset = asStringArray(daily?.["sunset"]);
    const daylight = asNumberArray(daily?.["daylight_duration"]);
    const precipUnit =
      typeof dailyUnits["precipitation_sum"] === "string"
        ? (dailyUnits["precipitation_sum"] as string)
        : "inch";

    for (let i = 0; i < dailyTimes.length; i += 1) {
      const date = dailyTimes[i];
      if (!date || !dates.includes(date)) continue;

      const max = tMax?.[i];
      if (max !== null && max !== undefined) set(date, "tempMaxF", max, "daily.temperature_2m_max");

      const min = tMin?.[i];
      if (min !== null && min !== undefined) set(date, "tempMinF", min, "daily.temperature_2m_min");

      const sum = precipSum?.[i];
      if (sum !== null && sum !== undefined) {
        set(date, "precipitationIn", toInches(sum, precipUnit), "daily.precipitation_sum");
      }

      const rise = sunrise?.[i];
      if (rise) set(date, "sunriseLocal", rise, "daily.sunrise");

      const setTime = sunset?.[i];
      if (setTime) set(date, "sunsetLocal", setTime, "daily.sunset");

      const seconds = daylight?.[i];
      if (seconds !== null && seconds !== undefined) {
        set(date, "daylightHours", seconds / 3600, "daily.daylight_duration");
      } else if (rise && setTime) {
        const hours = (Date.parse(setTime) - Date.parse(rise)) / 3_600_000;
        if (Number.isFinite(hours) && hours > 0) {
          set(date, "daylightHours", hours, "daily.sunrise+sunset");
        }
      }
    }

    // ---- hourly block ------------------------------------------------
    const hourly = asRecord(payload["hourly"]);
    const hourlyUnits = asRecord(payload["hourly_units"]) ?? {};
    const times = asStringArray(hourly?.["time"]) ?? [];

    const temps = asNumberArray(hourly?.["temperature_2m"]);
    const precip = asNumberArray(hourly?.["precipitation"]);
    const precipProb = asNumberArray(hourly?.["precipitation_probability"]);
    const wind = asNumberArray(hourly?.["wind_speed_10m"]);
    const gust = asNumberArray(hourly?.["wind_gusts_10m"]);
    const snow = asNumberArray(hourly?.["snow_depth"]);

    const hourlyPrecipUnit =
      typeof hourlyUnits["precipitation"] === "string"
        ? (hourlyUnits["precipitation"] as string)
        : "inch";
    const snowUnit =
      typeof hourlyUnits["snow_depth"] === "string"
        ? (hourlyUnits["snow_depth"] as string)
        : "m";

    // Daytime aggregates, built per requested date.
    const dayWind = new Map<string, number>();
    const dayGust = new Map<string, number>();
    const dayProb = new Map<string, number>();
    const daySnow = new Map<string, number>();
    const dayStartTemp = new Map<string, number>();

    // Rolling 72-hour precipitation totals ending at each date's midnight.
    const hourlyPrecipByTs: { ts: number; inches: number }[] = [];

    for (let i = 0; i < times.length; i += 1) {
      const stamp = times[i];
      if (!stamp) continue;
      const date = dateOf(stamp);
      const hour = hourOf(stamp);

      const p = precip?.[i];
      if (p !== null && p !== undefined) {
        hourlyPrecipByTs.push({
          ts: Date.parse(`${stamp}:00Z`),
          inches: toInches(p, hourlyPrecipUnit),
        });
      }

      if (!dates.includes(date)) continue;

      if (hour === 9) {
        const t = temps?.[i];
        if (t !== null && t !== undefined) dayStartTemp.set(date, t);
      }

      // Daylight-ish window: what a user is actually out in.
      if (hour >= 7 && hour <= 19) {
        const w = wind?.[i];
        if (w !== null && w !== undefined) {
          dayWind.set(date, Math.max(dayWind.get(date) ?? 0, w));
        }
        const g = gust?.[i];
        if (g !== null && g !== undefined) {
          dayGust.set(date, Math.max(dayGust.get(date) ?? 0, g));
        }
        const pp = precipProb?.[i];
        if (pp !== null && pp !== undefined) {
          dayProb.set(date, Math.max(dayProb.get(date) ?? 0, pp));
        }
      }

      const s = snow?.[i];
      if (s !== null && s !== undefined) {
        daySnow.set(date, Math.max(daySnow.get(date) ?? 0, toInches(s, snowUnit)));
      }
    }

    for (const date of dates) {
      const w = dayWind.get(date);
      if (w !== undefined) set(date, "windMph", w, "hourly.wind_speed_10m");

      const g = dayGust.get(date);
      if (g !== undefined) set(date, "windGustMph", g, "hourly.wind_gusts_10m");

      const pp = dayProb.get(date);
      if (pp !== undefined) set(date, "precipitationChancePct", pp, "hourly.precipitation_probability");

      const s = daySnow.get(date);
      if (s !== undefined) set(date, "snowDepthIn", s, "hourly.snow_depth");

      const t = dayStartTemp.get(date);
      if (t !== undefined) set(date, "tempAtStartF", t, "hourly.temperature_2m@09:00");

      const midnight = Date.parse(`${date}T00:00:00Z`);
      if (Number.isFinite(midnight)) {
        const windowStart = midnight - 72 * 3_600_000;
        let total = 0;
        let sawAny = false;
        for (const entry of hourlyPrecipByTs) {
          if (entry.ts >= windowStart && entry.ts < midnight) {
            total += entry.inches;
            sawAny = true;
          }
        }
        if (sawAny) {
          set(date, "precipitationPrior72hIn", total, "hourly.precipitation (prior 72h)");
        }
      }
    }

    return { values, refs };
  },
};
