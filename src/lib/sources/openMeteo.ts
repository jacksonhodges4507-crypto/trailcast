import type { SourceAdapter, SourceContext, SourceResult } from "./types";
import { asNumberArray, asRecord, asStringArray, key } from "./types";
import type { HourPoint, SourceRef } from "../types";
import { createBatcher, pointUrl } from "./batch";

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

const HOURLY = [
  "temperature_2m",
  "precipitation",
  "precipitation_probability",
  "wind_speed_10m",
  "wind_gusts_10m",
  "snow_depth",
  "pressure_msl",
  "cloud_cover",
] as const;

/**
 * Pressure levels, for what the air is doing above the trailhead.
 *
 * 850 hPa sits near 5,000 ft, 700 near 10,400 and 600 near 14,500, so these
 * three bracket every Utah trailhead and summit including Kings Peak. They
 * cost no extra request -- they ride along in the one already being made for
 * this grid cell -- and unlike a fixed lapse rate they show an inversion the
 * right way round.
 */
const LEVELS_HPA = [850, 700, 600] as const;

const PRESSURE_HOURLY = LEVELS_HPA.flatMap((hPa) => [
  `temperature_${hPa}hPa`,
  `wind_speed_${hPa}hPa`,
  `geopotential_height_${hPa}hPa`,
]);

const DAILY = [
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "sunrise",
  "sunset",
  "daylight_duration",
] as const;

const PARAMS: Record<string, string> = {
  hourly: [...HOURLY, ...PRESSURE_HOURLY].join(","),
  daily: DAILY.join(","),
  timezone: "auto",
  temperature_unit: "fahrenheit",
  wind_speed_unit: "mph",
  precipitation_unit: "inch",
  past_days: "3",
  forecast_days: "7",
};

function buildUrl(lat: number, lon: number): string {
  return pointUrl(ENDPOINT, PARAMS, lat, lon);
}

const forecastFor = createBatcher({
  endpoint: ENDPOINT,
  params: PARAMS,
  ttlSeconds: 30 * 60,
  staleSeconds: 12 * 60 * 60,
  label: "Open-Meteo",
});

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

  async fetch({ point, dates }: SourceContext): Promise<SourceResult> {
    const url = buildUrl(point.lat, point.lon);
    const payload = await forecastFor(point.lat, point.lon);

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
    const extras: Record<string, unknown> = {};

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
    const pressure = asNumberArray(hourly?.["pressure_msl"]);
    const cloud = asNumberArray(hourly?.["cloud_cover"]);

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
    const dayCloud = new Map<string, number[]>();
    // The whole shape of the day, for the hourly strip.
    const dayHours = new Map<string, HourPoint[]>();
    // Pressure at a fixed hour each day, so a day-over-day trend is comparable.
    const noonPressure = new Map<string, number>();

    // The air column, gathered over daylight hours: mean height and
    // temperature, strongest wind. Mean temperature because the summit
    // difference should describe the day rather than one hour of it;
    // strongest wind because that is the one worth knowing about.
    const levelSeries = LEVELS_HPA.map((hPa) => ({
      hPa,
      height: asNumberArray(hourly?.[`geopotential_height_${hPa}hPa`]),
      temp: asNumberArray(hourly?.[`temperature_${hPa}hPa`]),
      wind: asNumberArray(hourly?.[`wind_speed_${hPa}hPa`]),
    }));
    const heightUnit =
      typeof hourlyUnits[`geopotential_height_${LEVELS_HPA[0]}hPa`] === "string"
        ? (hourlyUnits[`geopotential_height_${LEVELS_HPA[0]}hPa`] as string)
        : "m";
    const toFeet = (value: number) => (heightUnit === "ft" ? value : value * 3.28084);
    interface LevelBucket {
      heights: number[];
      temps: number[];
      windMax: number;
    }
    const dayProfile = new Map<string, Map<number, LevelBucket>>();

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

      // Recorded for every day in the payload, not just the requested ones:
      // a 24-hour trend needs the day before, which is never itself a
      // requested date. Reading it inside the guard below left the trend
      // permanently unavailable.
      if (hour === 12) {
        const hpa = pressure?.[i];
        if (hpa !== null && hpa !== undefined) noonPressure.set(date, hpa);
      }

      if (!dates.includes(date)) continue;

      if (hour === 9) {
        const t = temps?.[i];
        if (t !== null && t !== undefined) dayStartTemp.set(date, t);
      }

      // The hours somebody could plausibly be out in, kept one by one.
      if (hour >= 6 && hour <= 20) {
        const point: HourPoint = { hour };
        const ht = temps?.[i];
        if (ht !== null && ht !== undefined) point.tempF = ht;
        const hp = precipProb?.[i];
        if (hp !== null && hp !== undefined) point.precipChancePct = hp;
        const hw = wind?.[i];
        if (hw !== null && hw !== undefined) point.windMph = hw;
        const hg = gust?.[i];
        if (hg !== null && hg !== undefined) point.gustMph = hg;
        const hc = cloud?.[i];
        if (hc !== null && hc !== undefined) point.cloudPct = hc;
        const list = dayHours.get(date) ?? [];
        list.push(point);
        dayHours.set(date, list);
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

        const cc = cloud?.[i];
        if (cc !== null && cc !== undefined) {
          const bucket = dayCloud.get(date) ?? [];
          bucket.push(cc);
          dayCloud.set(date, bucket);
        }

        const byLevel = dayProfile.get(date) ?? new Map<number, LevelBucket>();
        for (const level of levelSeries) {
          const height = level.height?.[i];
          if (height === null || height === undefined) continue;
          const bucket = byLevel.get(level.hPa) ?? { heights: [], temps: [], windMax: 0 };
          bucket.heights.push(toFeet(height));
          const lt = level.temp?.[i];
          if (lt !== null && lt !== undefined) bucket.temps.push(lt);
          const lw = level.wind?.[i];
          if (lw !== null && lw !== undefined) bucket.windMax = Math.max(bucket.windMax, lw);
          byLevel.set(level.hPa, bucket);
        }
        dayProfile.set(date, byLevel);
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

      const strip = dayHours.get(date);
      if (strip && strip.length > 0) {
        strip.sort((a, b) => a.hour - b.hour);
        extras[key(date, "hours")] = strip;
        refs[key(date, "hours")] = makeRef("hourly (06:00-20:00)");
      }

      const byLevel = dayProfile.get(date);
      if (byLevel && byLevel.size >= 2) {
        const levels = LEVELS_HPA.map((hPa) => {
          const bucket = byLevel.get(hPa);
          if (!bucket || bucket.heights.length === 0) return null;
          const mean = (list: number[]) => list.reduce((sum, v) => sum + v, 0) / list.length;
          const level: {
            hPa: number;
            heightFt: number;
            tempF?: number;
            windMph?: number;
          } = { hPa, heightFt: mean(bucket.heights) };
          if (bucket.temps.length > 0) level.tempF = mean(bucket.temps);
          if (bucket.windMax > 0) level.windMph = bucket.windMax;
          return level;
        }).filter((level) => level !== null);

        if (levels.length >= 2) {
          extras[key(date, "profile")] = { levels };
          refs[key(date, "profile")] = makeRef(
            `hourly.${LEVELS_HPA.map((h) => `${h}hPa`).join("/")} (daytime)`,
          );
        }
      }

      const clouds = dayCloud.get(date);
      if (clouds && clouds.length > 0) {
        const mean = clouds.reduce((sum, v) => sum + v, 0) / clouds.length;
        set(date, "cloudCoverPct", mean, "hourly.cloud_cover (daytime mean)");
      }

      // Barometric trend: noon today against noon the day before. Falling
      // pressure ahead of a front is the classic feeding window; a sharp rise
      // behind one is the classic dead day.
      const todayPressure = noonPressure.get(date);
      if (todayPressure !== undefined) {
        set(date, "pressureHpa", todayPressure, "hourly.pressure_msl@12:00");
        const previous = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000)
          .toISOString()
          .slice(0, 10);
        const yesterdayPressure = noonPressure.get(previous);
        if (yesterdayPressure !== undefined) {
          set(
            date,
            "pressureChangeHpa",
            todayPressure - yesterdayPressure,
            "hourly.pressure_msl (24 h change)",
          );
        }
      }

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

        // Hours since the last measurable hour of precipitation, looking back
        // up to 96 h. Rock dries as a function of elapsed time, not total
        // volume: a tenth of an inch yesterday matters more to a sandstone
        // crag than an inch four days ago.
        const lookbackStart = midnight - 96 * 3_600_000;
        let lastWet = -Infinity;
        for (const entry of hourlyPrecipByTs) {
          if (entry.ts >= lookbackStart && entry.ts < midnight && entry.inches >= 0.01) {
            lastWet = Math.max(lastWet, entry.ts);
          }
        }
        if (Number.isFinite(lastWet)) {
          set(
            date,
            "hoursSincePrecip",
            (midnight - lastWet) / 3_600_000,
            "hourly.precipitation (hours since last wet hour)",
          );
        }
      }
    }

    return { values, refs, extras };
  },
};
