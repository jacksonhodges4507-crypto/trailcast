import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openMeteoAdapter } from "@/lib/sources/openMeteo";
import { airQualityAdapter } from "@/lib/sources/airQuality";
import { wildfireAdapter } from "@/lib/sources/wildfire";
import { gather } from "@/lib/sources";
import { assembleConditions } from "@/lib/conditions";
import { clearCache } from "@/lib/cache";

const TARGET = "2026-09-19";
const POINT = { lat: 40.5, lon: -111.7 };

/** Hourly timestamps for a run of days, at one-hour resolution. */
function hours(days: string[]): string[] {
  const out: string[] = [];
  for (const day of days) {
    for (let h = 0; h < 24; h += 1) {
      out.push(`${day}T${String(h).padStart(2, "0")}:00`);
    }
  }
  return out;
}

const DAYS = ["2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"];
const HOURLY_TIME = hours(DAYS);

function forecastPayload() {
  return {
    timezone: "America/Denver",
    daily: {
      time: DAYS,
      temperature_2m_max: [70, 71, 68, 66],
      temperature_2m_min: [45, 46, 44, 43],
      precipitation_sum: [0.1, 0.1, 0.1, 0],
      sunrise: DAYS.map((d) => `${d}T07:05`),
      sunset: DAYS.map((d) => `${d}T19:20`),
      daylight_duration: DAYS.map(() => 44_100),
    },
    daily_units: { precipitation_sum: "inch" },
    hourly: {
      time: HOURLY_TIME,
      // 0.01" every hour before the target day, nothing on the day itself.
      precipitation: HOURLY_TIME.map((t) => (t.startsWith(TARGET) ? 0 : 0.01)),
      precipitation_probability: HOURLY_TIME.map((t) =>
        t.startsWith(TARGET) ? 15 : 60,
      ),
      temperature_2m: HOURLY_TIME.map((t) => (t.endsWith("T09:00") ? 52 : 60)),
      wind_speed_10m: HOURLY_TIME.map((t) => {
        const hour = Number(t.slice(11, 13));
        // A 30 mph spike at 03:00, outside the daylight window we aggregate.
        return hour === 3 ? 30 : 8;
      }),
      wind_gusts_10m: HOURLY_TIME.map(() => 14),
      // Reported in metres, as Open-Meteo does by default.
      snow_depth: HOURLY_TIME.map(() => 0.0254),
    },
    hourly_units: { precipitation: "inch", snow_depth: "m" },
  };
}

function stubFetch(handler: (url: string) => unknown) {
  vi.stubGlobal("fetch", async (input: unknown) => {
    const url = String(input);
    const payload = handler(url);
    if (payload instanceof Error) throw payload;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => payload,
    } as unknown as Response;
  });
}

beforeEach(() => clearCache());
afterEach(() => vi.unstubAllGlobals());

describe("openMeteoAdapter", () => {
  it("normalises a forecast payload into flat, dated fields", async () => {
    stubFetch(() => forecastPayload());

    const result = await openMeteoAdapter.fetch({ point: POINT, dates: [TARGET] });

    expect(result.values[`${TARGET}:tempMaxF`]).toBe(66);
    expect(result.values[`${TARGET}:tempMinF`]).toBe(43);
    expect(result.values[`${TARGET}:tempAtStartF`]).toBe(52);
    expect(result.values[`${TARGET}:daylightHours`]).toBeCloseTo(12.25, 2);
  });

  it("aggregates wind over the daylight window only", async () => {
    stubFetch(() => forecastPayload());
    const result = await openMeteoAdapter.fetch({ point: POINT, dates: [TARGET] });
    // The 30 mph spike at 03:00 must not leak into the daytime figure.
    expect(result.values[`${TARGET}:windMph`]).toBe(8);
  });

  it("converts snow depth out of metres", async () => {
    stubFetch(() => forecastPayload());
    const result = await openMeteoAdapter.fetch({ point: POINT, dates: [TARGET] });
    // 0.0254 m is exactly one inch.
    expect(result.values[`${TARGET}:snowDepthIn`]).toBeCloseTo(1, 3);
  });

  it("totals precipitation over the preceding 72 hours", async () => {
    stubFetch(() => forecastPayload());
    const result = await openMeteoAdapter.fetch({ point: POINT, dates: [TARGET] });
    // 72 hours at 0.01" each.
    expect(result.values[`${TARGET}:precipitationPrior72hIn`]).toBeCloseTo(0.72, 2);
  });

  it("attaches provenance to every value it produces", async () => {
    stubFetch(() => forecastPayload());
    const result = await openMeteoAdapter.fetch({ point: POINT, dates: [TARGET] });

    for (const key of Object.keys(result.values)) {
      expect(result.refs[key]).toBeDefined();
      expect(result.refs[key]?.url).toContain("api.open-meteo.com");
    }
  });

  it("survives a payload missing whole blocks", async () => {
    stubFetch(() => ({ timezone: "America/Denver" }));
    const result = await openMeteoAdapter.fetch({ point: POINT, dates: [TARGET] });
    expect(result.values[`${TARGET}:tempMaxF`]).toBeUndefined();
    // It must not throw, and it must not invent values.
    expect(result.values[`${TARGET}:timezone`]).toBe("America/Denver");
  });
});

describe("airQualityAdapter", () => {
  it("takes the daytime peak, not the overnight low", async () => {
    stubFetch(() => ({
      hourly: {
        time: hours([TARGET]),
        us_aqi: hours([TARGET]).map((t) => (Number(t.slice(11, 13)) === 14 ? 160 : 20)),
        pm2_5: hours([TARGET]).map(() => 8),
      },
    }));

    const result = await airQualityAdapter.fetch({ point: POINT, dates: [TARGET] });
    expect(result.values[`${TARGET}:usAqi`]).toBe(160);
  });
});

describe("wildfireAdapter", () => {
  it("computes distance to a perimeter and sorts nearest first", async () => {
    stubFetch(() => ({
      features: [
        {
          properties: { poly_IncidentName: "Far Fire", poly_GISAcres: 500 },
          geometry: { type: "Polygon", coordinates: [[[-111.4, 40.7], [-111.4, 40.7]]] },
        },
        {
          properties: { poly_IncidentName: "Near Fire", poly_GISAcres: 1200 },
          geometry: { type: "Polygon", coordinates: [[[-111.71, 40.51], [-111.71, 40.51]]] },
        },
      ],
    }));

    const result = await wildfireAdapter.fetch({ point: POINT, dates: [TARGET] });
    const fires = result.extras?.[`${TARGET}:wildfires`] as { name: string; distanceMi: number }[];

    expect(fires).toHaveLength(2);
    expect(fires[0]?.name).toBe("Near Fire");
    expect(fires[0]?.distanceMi).toBeLessThan(2);
    expect(fires[1]?.name).toBe("Far Fire");
  });

  it("drops perimeters outside the alert radius", async () => {
    stubFetch(() => ({
      features: [
        {
          properties: { poly_IncidentName: "Distant Fire" },
          geometry: { type: "Polygon", coordinates: [[[-109.5, 38.5], [-109.5, 38.5]]] },
        },
      ],
    }));

    const result = await wildfireAdapter.fetch({ point: POINT, dates: [TARGET] });
    const fires = result.extras?.[`${TARGET}:wildfires`] as unknown[];
    expect(fires).toHaveLength(0);
  });
});

describe("gather", () => {
  it("isolates a failing source instead of failing the request", async () => {
    stubFetch((url) => {
      if (url.includes("air-quality")) return new Error("upstream exploded");
      if (url.includes("arcgis")) return { features: [] };
      return forecastPayload();
    });

    const result = await gather({ point: POINT, dates: [TARGET] });

    const air = result.status.find((s) => s.sourceId === "open-meteo-aqi");
    const weather = result.status.find((s) => s.sourceId === "open-meteo");

    expect(air?.ok).toBe(false);
    expect(air?.error).toContain("upstream exploded");
    expect(weather?.ok).toBe(true);

    // Weather values are still present despite the air-quality outage.
    expect(result.values[`${TARGET}:tempMaxF`]).toBe(66);
    expect(result.values[`${TARGET}:usAqi`]).toBeUndefined();
  });

  it("assembles conditions that report what is missing", async () => {
    stubFetch((url) => {
      if (url.includes("air-quality")) return new Error("down");
      if (url.includes("arcgis")) return { features: [] };
      return forecastPayload();
    });

    const gathered = await gather({ point: POINT, dates: [TARGET] });
    const conditions = assembleConditions(gathered, TARGET);

    expect(conditions.tempMaxF).toBe(66);
    expect(conditions.usAqi).toBeUndefined();
    expect(conditions.wildfires).toEqual([]);
    expect(conditions.refs["tempMaxF"]).toBeDefined();
    expect(conditions.refs["usAqi"]).toBeUndefined();
  });

  it("serves the second call for the same cell from cache", async () => {
    let calls = 0;
    stubFetch((url) => {
      calls += 1;
      if (url.includes("air-quality")) return { hourly: { time: [], us_aqi: [], pm2_5: [] } };
      if (url.includes("arcgis")) return { features: [] };
      return forecastPayload();
    });

    await gather({ point: POINT, dates: [TARGET] });
    const callsAfterFirst = calls;

    const second = await gather({ point: POINT, dates: [TARGET] });

    expect(calls).toBe(callsAfterFirst);
    expect(second.status.every((s) => s.cached)).toBe(true);
  });
});
