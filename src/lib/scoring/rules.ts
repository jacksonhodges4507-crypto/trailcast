import type { ActivityId, Conditions, Factor, FactorId, SourceRef, Trail } from "../types";

/**
 * Rules are pure: (trail, conditions, activity) -> Factor. No I/O, no clock,
 * no randomness. That is what makes the verdict testable and what lets the
 * same engine run in a batch job as easily as in a request handler.
 *
 * Every rule must either produce a score with at least one source, or set
 * `missingReason` and leave `score` undefined. Guessing is never allowed:
 * a missing input lowers confidence rather than inventing a number.
 */

export interface RuleContext {
  trail: Trail;
  conditions: Conditions;
  activity: ActivityId;
}

export type Rule = (context: RuleContext) => Factor;

export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

/** Linear interpolation of a score between two breakpoints. */
export function between(value: number, lo: number, hi: number, loScore: number, hiScore: number): number {
  if (hi === lo) return loScore;
  const t = (value - lo) / (hi - lo);
  return clamp(loScore + t * (hiScore - loScore));
}

function collect(conditions: Conditions, fields: string[]): SourceRef[] {
  const out: SourceRef[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    const ref = conditions.refs[field];
    if (!ref) continue;
    const id = `${ref.sourceId}|${ref.field ?? field}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(ref);
  }
  return out;
}

function missing(id: FactorId, label: string, why: string): Factor {
  return { id, label, weight: 0, reason: why, missingReason: why, sources: [] };
}

const round = (n: number) => Math.round(n);

// ---------------------------------------------------------------------------
// Temperature
// ---------------------------------------------------------------------------

/**
 * Comfort is not symmetric: most people tolerate 40 F far better than 95 F,
 * and an unshaded trail runs materially hotter than the air temperature the
 * model reports. We add a radiant-load bump on exposed routes above 70 F.
 */
export const temperatureRule: Rule = ({ trail, conditions }) => {
  const high = conditions.tempMaxF;
  if (high === undefined) {
    return missing("temperature", "Temperature", "No temperature forecast available");
  }

  const radiantBump = trail.exposed && high > 70 ? 6 : 0;
  const felt = high + radiantBump;

  let score: number;
  if (felt >= 40 && felt <= 68) score = 100;
  else if (felt > 68) score = clamp(100 - (felt - 68) * 3.2);
  else score = clamp(100 - (40 - felt) * 2.2);

  const low = conditions.tempMinF;
  const range = low !== undefined ? `${round(low)}-${round(high)} F` : `${round(high)} F`;

  let reason: string;
  if (felt > 92) reason = `Dangerous heat at ${range}${trail.exposed ? " with no shade" : ""}`;
  else if (felt > 80) reason = `Hot at ${range}${trail.exposed ? " on an exposed route" : ""} — start early`;
  else if (felt < 20) reason = `Bitter at ${range}; full winter kit`;
  else if (felt < 40) reason = `Cold at ${range}; layers needed`;
  else reason = `Comfortable at ${range}`;

  return {
    id: "temperature",
    label: "Temperature",
    score,
    weight: 0,
    reason,
    sources: collect(conditions, ["tempMaxF", "tempMinF"]),
  };
};

// ---------------------------------------------------------------------------
// Precipitation
// ---------------------------------------------------------------------------

/**
 * Combines how likely rain is with how much is expected. The veto covers the
 * genuinely dangerous case: heavy precipitation on an exposed route, which in
 * the desert Southwest means flash flooding and in the alpine means lightning.
 */
export const precipitationRule: Rule = ({ trail, conditions, activity }) => {
  const amount = conditions.precipitationIn;
  const chance = conditions.precipitationChancePct;

  if (amount === undefined && chance === undefined) {
    return missing("precipitation", "Precipitation", "No precipitation forecast available");
  }

  const inches = amount ?? 0;
  const pct = chance ?? (inches > 0.02 ? 70 : 10);

  let score = 100 - pct * 0.45 - Math.min(60, inches * 75);
  // Wet rock ends a climbing day outright, long before it ends a hike.
  if (activity === "climb" && inches > 0.05) score -= 30;
  score = clamp(score);

  const veto = trail.exposed && inches >= 1.0;

  let reason: string;
  if (veto) reason = `${inches.toFixed(2)}" forecast on fully exposed terrain — flash flood and lightning risk`;
  else if (inches >= 0.3) reason = `Wet: ${inches.toFixed(2)}" expected, ${round(pct)}% chance`;
  else if (pct >= 50) reason = `${round(pct)}% chance of showers, ${inches.toFixed(2)}" expected`;
  else if (pct >= 20) reason = `Slight chance of showers (${round(pct)}%)`;
  else reason = "Dry";

  return {
    id: "precipitation",
    label: "Precipitation",
    score,
    weight: 0,
    reason,
    veto,
    sources: collect(conditions, ["precipitationIn", "precipitationChancePct"]),
  };
};

// ---------------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------------

/**
 * Gusts matter, not averages: a 40 mph gust is what puts someone off a ridge.
 * Where no gust forecast exists we derive a conservative estimate from the
 * sustained speed rather than dropping the factor.
 */
export const windRule: Rule = ({ trail, conditions }) => {
  const sustained = conditions.windMph;
  const gustRaw = conditions.windGustMph;

  if (sustained === undefined && gustRaw === undefined) {
    return missing("wind", "Wind", "No wind forecast available");
  }

  const gust = gustRaw ?? (sustained ?? 0) * 1.4;
  const sensitivity = trail.exposed ? 2.6 : 1.5;
  const score = clamp(100 - Math.max(0, gust - 12) * sensitivity);
  const veto = trail.exposed && gust >= 45;

  let reason: string;
  if (veto) reason = `Gusts to ${round(gust)} mph on exposed, fall-consequence terrain`;
  else if (gust >= 30) reason = `Strong gusts to ${round(gust)} mph`;
  else if (gust >= 18) reason = `Breezy, gusting ${round(gust)} mph`;
  else reason = `Light wind${gustRaw !== undefined ? `, gusts ${round(gust)} mph` : ""}`;

  return {
    id: "wind",
    label: "Wind",
    score,
    weight: 0,
    reason,
    veto,
    sources: collect(conditions, ["windMph", "windGustMph"]),
  };
};

// ---------------------------------------------------------------------------
// Air quality
// ---------------------------------------------------------------------------

/**
 * Breakpoints follow the US AQI categories rather than a smooth curve,
 * because that is the scale the health guidance is written against.
 */
export const airQualityRule: Rule = ({ conditions }) => {
  const aqi = conditions.usAqi;
  if (aqi === undefined) {
    return missing("air_quality", "Air quality", "No air-quality data available");
  }

  let score: number;
  if (aqi <= 50) score = between(aqi, 0, 50, 100, 92);
  else if (aqi <= 100) score = between(aqi, 50, 100, 92, 68);
  else if (aqi <= 150) score = between(aqi, 100, 150, 68, 38);
  else if (aqi <= 200) score = between(aqi, 150, 200, 38, 14);
  else score = between(aqi, 200, 300, 14, 0);

  const veto = aqi >= 250;

  let reason: string;
  if (aqi <= 50) reason = `Clean air (AQI ${round(aqi)})`;
  else if (aqi <= 100) reason = `Moderate air quality (AQI ${round(aqi)})`;
  else if (aqi <= 150) reason = `Unhealthy for sensitive groups (AQI ${round(aqi)})`;
  else if (aqi <= 200) reason = `Unhealthy air (AQI ${round(aqi)}) — hard efforts inadvisable`;
  else reason = `Very unhealthy air (AQI ${round(aqi)})`;

  return {
    id: "air_quality",
    label: "Air quality",
    score,
    weight: 0,
    reason,
    veto,
    sources: collect(conditions, ["usAqi", "pm25"]),
  };
};

// ---------------------------------------------------------------------------
// Daylight
// ---------------------------------------------------------------------------

/** Rough moving pace by activity, in miles per hour on trail. */
const PACE_MPH: Record<ActivityId, number> = {
  hike: 2.0,
  trail_run: 5.0,
  mtb: 6.5,
  climb: 1.0,
};

/**
 * Naismith-style estimate: distance at an activity pace, plus half an hour
 * per thousand feet of climbing. Compared against the actual daylight window
 * for that date and latitude.
 */
export function estimateHours(trail: Trail, activity: ActivityId): number {
  const pace = PACE_MPH[activity];
  const climbing = (trail.gainFt / 1000) * 0.5;
  // Climbing days are governed by time at the crag, not approach distance.
  if (activity === "climb") return 4 + climbing;
  return trail.distanceMi / pace + climbing;
}

export const daylightRule: Rule = ({ trail, conditions, activity }) => {
  const hours = conditions.daylightHours;
  if (hours === undefined) {
    return missing("daylight", "Daylight", "No sunrise/sunset data available");
  }

  const needed = estimateHours(trail, activity);
  const ratio = hours / needed;
  const score = between(ratio, 0.95, 1.7, 0, 100);

  let reason: string;
  if (ratio < 1) reason = `${hours.toFixed(1)} h of daylight for a ~${needed.toFixed(1)} h outing — headlamp required`;
  else if (ratio < 1.25) reason = `${hours.toFixed(1)} h of daylight against a ~${needed.toFixed(1)} h outing; little margin`;
  else reason = `${hours.toFixed(1)} h of daylight, comfortable for a ~${needed.toFixed(1)} h outing`;

  return {
    id: "daylight",
    label: "Daylight",
    score,
    weight: 0,
    reason,
    sources: collect(conditions, ["daylightHours", "sunriseLocal", "sunsetLocal"]),
  };
};

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

/** How badly recent water degrades each surface type. */
const SURFACE_SENSITIVITY: Record<Trail["surface"], number> = {
  clay: 1.0,
  dirt: 0.6,
  mixed: 0.5,
  gravel: 0.3,
  rock: 0.15,
};

/** North-facing ground sees less sun and stays wet and snowy far longer. */
const ASPECT_DRYING: Record<Trail["aspect"], number> = {
  N: 1.35,
  NE: 1.3,
  NW: 1.3,
  E: 1.05,
  W: 1.0,
  SE: 0.85,
  SW: 0.8,
  S: 0.75,
  mixed: 1.0,
};

/**
 * The factor a generic forecast cannot produce: it needs the trail's own
 * soil and aspect. Riding wet clay is how trail networks get rutted for a
 * season, so mountain biking weights this highest of any activity.
 */
export const surfaceRule: Rule = ({ trail, conditions, activity }) => {
  const prior = conditions.precipitationPrior72hIn;
  const snow = conditions.snowDepthIn;

  if (prior === undefined && snow === undefined) {
    return missing("surface", "Trail surface", "No recent-precipitation history available");
  }

  const sensitivity = SURFACE_SENSITIVITY[trail.surface];
  const drying = ASPECT_DRYING[trail.aspect];
  const wetness = (prior ?? 0) * sensitivity * drying;

  let score = clamp(100 - wetness * 95);

  const snowIn = snow ?? 0;
  if (snowIn > 1) score = clamp(score - between(snowIn, 1, 18, 10, 70));

  // A rutted ride does lasting damage; a muddy hike is just a muddy hike.
  if (activity === "mtb" && wetness > 0.25) score = clamp(score - 15);

  let reason: string;
  if (snowIn > 6) reason = `${snowIn.toFixed(0)}" of snow on the ground; expect postholing`;
  else if (snowIn > 1) reason = `${snowIn.toFixed(1)}" of lingering snow on a ${trail.aspect}-facing route`;
  else if (wetness > 0.5) reason = `${(prior ?? 0).toFixed(2)}" of rain in 72 h on ${trail.surface} — likely muddy${activity === "mtb" ? "; riding it causes ruts" : ""}`;
  else if (wetness > 0.2) reason = `Some moisture from ${(prior ?? 0).toFixed(2)}" of recent rain; tacky in places`;
  else reason = `Dry and firm ${trail.surface}`;

  const waterNote =
    trail.waterCrossings > 0 && (prior ?? 0) > 0.5
      ? ` ${trail.waterCrossings} stream crossing${trail.waterCrossings > 1 ? "s" : ""} will be running high.`
      : "";

  return {
    id: "surface",
    label: "Trail surface",
    score,
    weight: 0,
    reason: reason + waterNote,
    sources: collect(conditions, ["precipitationPrior72hIn", "snowDepthIn"]),
  };
};

// ---------------------------------------------------------------------------
// Wildfire
// ---------------------------------------------------------------------------

export const wildfireRule: Rule = ({ conditions }) => {
  const fires = conditions.wildfires;
  if (fires === undefined) {
    return missing("wildfire", "Wildfire", "No wildfire perimeter data available");
  }

  if (fires.length === 0) {
    return {
      id: "wildfire",
      label: "Wildfire",
      score: 100,
      weight: 0,
      reason: "No active fire perimeters nearby",
      sources: collect(conditions, ["wildfires"]),
    };
  }

  const nearest = fires[0];
  if (!nearest) {
    return missing("wildfire", "Wildfire", "No wildfire perimeter data available");
  }

  const distance = nearest.distanceMi;
  const score = between(distance, 2, 35, 0, 95);
  const veto = distance <= 5;
  const acres = nearest.acres !== undefined ? ` (~${nearest.acres.toLocaleString()} acres)` : "";

  const reason = veto
    ? `${nearest.name} fire ${distance.toFixed(1)} mi away${acres} — expect closures`
    : `${nearest.name} fire ${distance.toFixed(0)} mi away${acres}; smoke possible`;

  return {
    id: "wildfire",
    label: "Wildfire",
    score,
    weight: 0,
    reason,
    veto,
    sources: collect(conditions, ["wildfires"]),
  };
};

export const RULES: Record<FactorId, Rule> = {
  temperature: temperatureRule,
  precipitation: precipitationRule,
  wind: windRule,
  air_quality: airQualityRule,
  daylight: daylightRule,
  surface: surfaceRule,
  wildfire: wildfireRule,
};
