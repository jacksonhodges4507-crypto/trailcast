import type { ConfirmedReport } from "./reports/kinds";
/**
 * Core domain types for TrailCast.
 *
 * Design note: every number that reaches a user is traceable back to the
 * request that produced it. `SourceRef` is threaded through observations,
 * factors and verdicts so the UI can always answer "says who, and when?".
 */

export type ActivityId = "hike" | "trail_run" | "mtb" | "climb" | "fish";

export interface Activity {
  id: ActivityId;
  label: string;
  /** Emoji used as a lightweight map/legend marker. */
  glyph: string;
  /**
   * Relative weight of each factor for this activity. Weights are
   * normalised at scoring time, so these are ratios, not percentages.
   */
  weights: Partial<Record<FactorId, number>>;
}

export type FactorId =
  | "temperature"
  | "precipitation"
  | "wind"
  | "air_quality"
  | "daylight"
  | "surface"
  | "rock"
  | "water_temp"
  | "water_flow"
  | "pressure"
  | "wildfire";

/**
 * Rock type governs how long a crag needs after rain before it is safe — and
 * in the case of desert sandstone, before climbing it stops destroying the
 * route. Western sandstone can lose up to 75% of its strength while wet.
 */
export type RockType =
  | "granite"
  | "quartzite"
  | "limestone"
  | "conglomerate"
  | "sandstone"
  | "basalt";

/** A single provenance record: one field, from one source, at one time. */
export interface SourceRef {
  /** Stable id of the adapter that produced this value. */
  sourceId: string;
  /** Human-readable name shown in the UI. */
  sourceName: string;
  /** Link a user can open to check the number themselves. */
  url: string;
  /** Attribution string required or requested by the provider. */
  attribution: string;
  /** ISO timestamp of when we fetched it. */
  fetchedAt: string;
  /** Which field of the upstream payload this came from. */
  field?: string;
}

/** Health of one upstream source for one request. */
export interface SourceStatus {
  sourceId: string;
  sourceName: string;
  ok: boolean;
  /** Milliseconds the fetch took (or took to fail). */
  latencyMs: number;
  /** Populated when ok === false. */
  error?: string;
  /** True when the value came from cache rather than a live fetch. */
  cached: boolean;
  /** Age of the cached entry in seconds, when cached. */
  cacheAgeSeconds?: number;
}

export interface Trail {
  id: string;
  name: string;
  region: string;
  state: string;
  lat: number;
  lon: number;
  /** Feet above sea level at the trailhead. */
  elevationFt: number;
  /** Feet of climbing over the full route. */
  gainFt: number;
  distanceMi: number;
  activities: ActivityId[];
  /**
   * Surface character, used by the surface rule to decide how badly
   * recent precipitation degrades the route.
   */
  surface: "dirt" | "clay" | "rock" | "gravel" | "mixed";
  /** Dominant aspect; north-facing routes hold snow and mud longer. */
  aspect: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "mixed";
  /** True when the route spends most of its time without tree cover. */
  exposed: boolean;
  /** Unbridged stream crossings along the route. */
  waterCrossings: number;
  /** Set for climbing areas; drives the rock-condition rule. */
  rockType?: RockType;
  /**
   * Whether `rockType` was verified against a guidebook or geological source,
   * or inferred from the surrounding region. Inferred values still score, but
   * the UI says so rather than implying a certainty we do not have.
   */
  rockTypeSource?: "curated" | "inferred";
  /** Route count, where the source dataset provides one. Used for prominence. */
  routes?: number;
  /** Fishing waters: a lake/reservoir/pond, or moving water. */
  waterKind?: "lake" | "river";
  /** Fishing waters imported from DWR: stocked species codes (see fishing/dwr.ts). */
  speciesCodes?: string[];
  /** DWR waters: last year stocked, and fish stocked since 2016 (a prominence proxy). */
  lastStocked?: number;
  stockedFish?: number;
  /** Attribution for imported areas. */
  sourceName?: string;
  sourceUrl?: string;
  blurb: string;
}

/** Normalised environmental readings for one place and one day. */
export interface Conditions {
  /** ISO date (YYYY-MM-DD) in the trail's local timezone. */
  date: string;
  timezone: string;
  tempMaxF?: number;
  tempMinF?: number;
  /** Temperature at the most likely start time, 09:00 local. */
  tempAtStartF?: number;
  precipitationIn?: number;
  /** Max hourly probability of precipitation across daylight hours, 0-100. */
  precipitationChancePct?: number;
  /** Total precipitation over the 72 hours before this date. */
  precipitationPrior72hIn?: number;
  /**
   * Hours since the last measurable precipitation, looking back up to 96 h.
   * Undefined when it has not rained in that window — which is good news, not
   * missing data, so rules treat it as "long dry".
   */
  hoursSincePrecip?: number;
  windMph?: number;
  windGustMph?: number;
  snowDepthIn?: number;
  usAqi?: number;
  pm25?: number;
  sunriseLocal?: string;
  sunsetLocal?: string;
  daylightHours?: number;
  /** Mean daytime cloud cover, 0-100. */
  cloudCoverPct?: number;
  /** Sea-level pressure at midday, hPa. */
  pressureHpa?: number;
  /** Change in midday pressure against the previous day, hPa. */
  pressureChangeHpa?: number;
  /** Water temperature at the nearest gauge, F. */
  waterTempF?: number;
  /** Discharge at the nearest gauge, cubic feet per second. */
  streamflowCfs?: number;
  /** How far that gauge is from the water. */
  gaugeDistanceMi?: number;
  /** USGS identifier of the gauge used. */
  gaugeId?: string;
  /** Active wildfire perimeters within the alert radius. */
  wildfires?: WildfireSummary[];
  /** Provenance for each populated field above. */
  refs: Record<string, SourceRef>;
}

export interface WildfireSummary {
  name: string;
  distanceMi: number;
  acres?: number;
  discoveredAt?: string;
}

export type Grade = "prime" | "good" | "marginal" | "poor" | "unsafe";

/** One scored dimension of the verdict. */
export interface Factor {
  id: FactorId;
  label: string;
  /** 0-100. Higher is better. Undefined when no data supported it. */
  score?: number;
  /** Weight actually applied after normalisation, 0-1. */
  weight: number;
  /**
   * The measured reading in its own units — "62 °F", "AQI 39", "31 h dry".
   *
   * This is what the panel leads with. The 0-100 `score` is an internal
   * comparison device; rendering it to a user as a percentage claimed a
   * precision it does not have and, worse, hid the actual number they came
   * for. Temperature is not a percentage.
   */
  display?: string;
  /** One sentence a human can read without looking at the number. */
  reason: string;
  /** Present when the factor could not be scored. */
  missingReason?: string;
  /** Hard stop: if true the whole verdict is forced to "unsafe". */
  veto?: boolean;
  sources: SourceRef[];
}

export interface Verdict {
  trailId: string;
  activity: ActivityId;
  date: string;
  /** 0-100 weighted composite, or undefined if nothing could be scored. */
  score?: number;
  grade: Grade;
  /** Short headline, e.g. "Good — cool and dry, breezy up high". */
  headline: string;
  factors: Factor[];
  /** Union of every source that contributed, de-duplicated. */
  sources: SourceRef[];
  /** Fraction of total weight that had data behind it, 0-1. */
  confidence: number;
}

/** Drive time from the user's location, when they have shared one. */
export interface Travel {
  /** One-way, free-flow: no traffic, closures or chain controls. */
  minutes: number;
  miles: number;
  /** "osrm" for routed road time; "estimate" for the straight-line fallback. */
  source: "osrm" | "estimate";
}

export interface TrailReport {
  trail: Trail;
  conditions: Conditions;
  verdict: Verdict;
  /** Present only when the request carried an origin. */
  travel?: Travel;
  /**
   * Visitor reports confirmed by 2+ distinct people in the last 48 h.
   * Unverified by any sensor, so they inform the narrative and never the score.
   */
  crowd?: ConfirmedReport[];
}

export interface ConditionsResponse {
  generatedAt: string;
  date: string;
  activity: ActivityId;
  reports: TrailReport[];
  sourceStatus: SourceStatus[];
  /** True when at least one source failed and results are partial. */
  degraded: boolean;
  /** How many areas were scored, and how many matched before the cap. */
  scored: number;
  available: number;
}

export interface AskQuery {
  activity: ActivityId;
  /** ISO date resolved from phrases like "saturday" or "tomorrow". */
  date: string;
  /** Free-text origin, when the user named one. */
  near?: string;
  /** Resolved origin coordinates, from a named place or the device. */
  origin?: { lat: number; lon: number; label: string };
  /** Where the origin came from, so the narrative can phrase it correctly. */
  originSource?: "place" | "device";
  /** Max drive radius in miles, when the user gave one. */
  withinMi?: number;
  maxDistanceMi?: number;
  maxGainFt?: number;
  /** Minimum climbing, for "a hard one" / "a big day". */
  minGainFt?: number;
  /** Rank shaded places up ("somewhere shady", "stay cool"). */
  preferShade?: boolean;
  /** Rank sun-facing places up ("somewhere warm", "in the sun"). */
  preferSun?: boolean;
  /** Only places with a lake or waterfall. */
  wantsWater?: boolean;
  /** Only crags of this rock. */
  rockType?: RockType;
  /** Only waters holding this fish (a Fish Dex species id). */
  species?: string;
  /** A specific place the question named, when we hold one (a trail id). */
  subject?: string;
  /** Other places the name could have meant, best first (trail ids). */
  subjectAlternatives?: string[];
  /** A place the question named that we do not hold, so we can say so. */
  unknownPlace?: string;
  /** How the caller's phrasing was turned into this query. */
  interpretation: string;
  /** "llm" when a model parsed it, "rules" for the deterministic parser. */
  parsedBy: "llm" | "rules";
}

export interface AskAnswer {
  query: AskQuery;
  /** Prose answer, grounded in `results`. */
  narrative: string;
  results: TrailReport[];
  sourceStatus: SourceStatus[];
  narratedBy: "llm" | "template";
}
