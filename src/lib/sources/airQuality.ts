import type { SourceAdapter, SourceContext, SourceResult } from "./types";
import { asNumberArray, asRecord, asStringArray, key } from "./types";
import { createBatcher, pointUrl } from "./batch";
import type { SourceRef } from "../types";

const ENDPOINT = "https://air-quality-api.open-meteo.com/v1/air-quality";

const AQ_PARAMS: Record<string, string> = {
  hourly: "us_aqi,pm2_5",
  timezone: "auto",
  forecast_days: "5",
};

const airFor = createBatcher({
  endpoint: ENDPOINT,
  params: AQ_PARAMS,
  ttlSeconds: 45 * 60,
  staleSeconds: 12 * 60 * 60,
  label: "Open-Meteo Air Quality",
});

/**
 * Air quality matters more than people expect in the Mountain West: summer
 * wildfire smoke and winter inversions both put the Wasatch Front into
 * unhealthy AQI while the sky still looks fine from a trailhead.
 */
export const airQualityAdapter: SourceAdapter = {
  id: "open-meteo-aqi",
  name: "Open-Meteo Air Quality",
  attribution: "Air quality data by Open-Meteo.com, derived from CAMS (CC BY 4.0)",
  homepage: "https://open-meteo.com/en/docs/air-quality-api",
  ttlSeconds: 30 * 60,
  staleSeconds: 6 * 60 * 60,

  async fetch({ point, dates }: SourceContext): Promise<SourceResult> {
    const url = pointUrl(ENDPOINT, AQ_PARAMS, point.lat, point.lon);
    const payload = await airFor(point.lat, point.lon);

    const fetchedAt = new Date().toISOString();
    const makeRef = (field: string): SourceRef => ({
      sourceId: airQualityAdapter.id,
      sourceName: airQualityAdapter.name,
      url,
      attribution: airQualityAdapter.attribution,
      fetchedAt,
      field,
    });

    const hourly = asRecord(payload["hourly"]);
    const times = asStringArray(hourly?.["time"]) ?? [];
    const aqi = asNumberArray(hourly?.["us_aqi"]);
    const pm25 = asNumberArray(hourly?.["pm2_5"]);

    // Peak daytime exposure is what a user feels, not the daily mean.
    const peakAqi = new Map<string, number>();
    const peakPm = new Map<string, number>();

    for (let i = 0; i < times.length; i += 1) {
      const stamp = times[i];
      if (!stamp) continue;
      const date = stamp.slice(0, 10);
      if (!dates.includes(date)) continue;

      const hour = Number(stamp.slice(11, 13));
      if (hour < 7 || hour > 19) continue;

      const a = aqi?.[i];
      if (a !== null && a !== undefined) {
        peakAqi.set(date, Math.max(peakAqi.get(date) ?? 0, a));
      }

      const p = pm25?.[i];
      if (p !== null && p !== undefined) {
        peakPm.set(date, Math.max(peakPm.get(date) ?? 0, p));
      }
    }

    const values: SourceResult["values"] = {};
    const refs: SourceResult["refs"] = {};

    for (const date of dates) {
      const a = peakAqi.get(date);
      if (a !== undefined) {
        values[key(date, "usAqi")] = a;
        refs[key(date, "usAqi")] = makeRef("hourly.us_aqi (daytime peak)");
      }
      const p = peakPm.get(date);
      if (p !== undefined) {
        values[key(date, "pm25")] = p;
        refs[key(date, "pm25")] = makeRef("hourly.pm2_5 (daytime peak)");
      }
    }

    return { values, refs };
  },
};
