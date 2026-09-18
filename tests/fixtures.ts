import type { Conditions, SourceRef, Trail } from "@/lib/types";

export const ref: SourceRef = {
  sourceId: "test",
  sourceName: "Test source",
  url: "https://example.test/data",
  attribution: "Test",
  fetchedAt: "2026-09-17T12:00:00.000Z",
  field: "test",
};

const ALL_FIELDS = [
  "tempMaxF",
  "tempMinF",
  "tempAtStartF",
  "precipitationIn",
  "precipitationChancePct",
  "precipitationPrior72hIn",
  "windMph",
  "windGustMph",
  "snowDepthIn",
  "usAqi",
  "pm25",
  "daylightHours",
  "sunriseLocal",
  "sunsetLocal",
  "wildfires",
];

function allRefs(): Record<string, SourceRef> {
  return Object.fromEntries(ALL_FIELDS.map((field) => [field, { ...ref, field }]));
}

/** A pleasant, fully-populated autumn day. */
export function goodConditions(overrides: Partial<Conditions> = {}): Conditions {
  return {
    date: "2026-09-19",
    timezone: "America/Denver",
    tempMaxF: 62,
    tempMinF: 44,
    tempAtStartF: 50,
    precipitationIn: 0,
    precipitationChancePct: 5,
    precipitationPrior72hIn: 0,
    windMph: 6,
    windGustMph: 10,
    snowDepthIn: 0,
    usAqi: 28,
    pm25: 6,
    daylightHours: 12.2,
    sunriseLocal: "2026-09-19T07:05",
    sunsetLocal: "2026-09-19T19:17",
    wildfires: [],
    refs: allRefs(),
    ...overrides,
  };
}

export function trail(overrides: Partial<Trail> = {}): Trail {
  return {
    id: "test-trail",
    name: "Test Trail",
    region: "Testville",
    state: "UT",
    lat: 40.5,
    lon: -111.7,
    elevationFt: 6000,
    gainFt: 1500,
    distanceMi: 6,
    activities: ["hike", "trail_run", "mtb", "climb"],
    surface: "dirt",
    aspect: "W",
    exposed: false,
    waterCrossings: 0,
    blurb: "A trail for testing.",
    ...overrides,
  };
}
