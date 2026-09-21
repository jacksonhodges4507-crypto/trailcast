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
 * Comfortable temperature band per activity, in F.
 *
 * Climbers are the outlier: friction falls off sharply with heat, so a 75 F
 * day that a hiker calls pleasant is a greasy, unsendable day on rock. The
 * cold end runs lower for the same reason.
 */
const COMFORT_BAND: Record<ActivityId, [number, number]> = {
  hike: [40, 68],
  trail_run: [35, 62],
  mtb: [40, 72],
  climb: [32, 60],
  fish: [40, 78],
};

/** How steeply each activity degrades above its band. */
const HEAT_SLOPE: Record<ActivityId, number> = {
  hike: 3.2,
  trail_run: 3.8,
  mtb: 3.0,
  climb: 3.6,
  fish: 2.4,
};

/**
 * Comfort is not symmetric: most people tolerate 40 F far better than 95 F,
 * and an unshaded trail runs materially hotter than the air temperature the
 * model reports. We add a radiant-load bump on exposed routes above 70 F.
 */
export const temperatureRule: Rule = ({ trail, conditions, activity }) => {
  const high = conditions.tempMaxF;
  if (high === undefined) {
    return missing("temperature", "Temperature", "No temperature forecast available");
  }

  const radiantBump = trail.exposed && high > 70 ? 6 : 0;
  const felt = high + radiantBump;

  const [lo, hi] = COMFORT_BAND[activity];

  let score: number;
  if (felt >= lo && felt <= hi) score = 100;
  else if (felt > hi) score = clamp(100 - (felt - hi) * HEAT_SLOPE[activity]);
  else score = clamp(100 - (lo - felt) * 2.2);

  const low = conditions.tempMinF;
  const range =
    low !== undefined ? `${round(low)}–${round(high)} °F` : `${round(high)} °F`;

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
    display: low !== undefined ? `${round(low)}–${round(high)} °F` : `${round(high)} °F`,
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
  if (veto) reason = `${inches.toFixed(2)} in of rain forecast on fully exposed terrain — flash flood and lightning risk`;
  else if (inches >= 0.3) reason = `Wet: ${inches.toFixed(2)} in of rain expected, ${round(pct)}% chance`;
  else if (pct >= 50) reason = `${round(pct)}% chance of showers, ${inches.toFixed(2)} in expected`;
  else if (pct >= 20) reason = `Slight chance of showers (${round(pct)}%)`;
  else reason = "Dry";

  return {
    id: "precipitation",
    label: "Precipitation",
    score,
    weight: 0,
    display: inches >= 0.01 ? `${inches.toFixed(2)} in · ${round(pct)}%` : `${round(pct)}% chance`,
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
    display: `${round(gust)} mph gusts`,
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
    display: `AQI ${round(aqi)}`,
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
  fish: 1.5,
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
    display: `${hours.toFixed(1)} h`,
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
 * The surface reading, as the condition rather than its cause.
 *
 * It used to show the rain total ("0.41 in 72 h"), which is the input, not
 * the answer: nobody standing at a trailhead wants a rainfall figure to decode,
 * they want to know whether it is muddy. The figure moves to the explanation,
 * where there is room to say what it means.
 */
function surfaceState(snowIn: number, wetness: number): string {
  if (snowIn > 6) return `snow, ${snowIn.toFixed(0)} in`;
  if (snowIn > 1) return "patchy snow";
  if (wetness > 0.5) return "muddy";
  if (wetness > 0.2) return "tacky";
  return "dry";
}

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
  if (snowIn > 6) reason = `${snowIn.toFixed(0)} in of snow on the ground; expect postholing`;
  else if (snowIn > 1) reason = `${snowIn.toFixed(1)} in of lingering snow on a ${trail.aspect}-facing route`;
  else if (wetness > 0.5) reason = `${(prior ?? 0).toFixed(2)} in of rain over the last 3 days on ${trail.surface} — likely muddy`;
  else if (wetness > 0.2) reason = `${(prior ?? 0).toFixed(2)} in of rain over the last 3 days; tacky in places`;
  else reason = `Dry and firm ${trail.surface}`;

  // The riding penalty above fires at wetness > 0.25, so the explanation has
  // to fire at the same threshold. A score that moves without a reason that
  // moves with it is how a user stops trusting the number.
  const rutNote =
    activity === "mtb" && wetness > 0.25 && snowIn <= 1
      ? "Riding it wet will cut ruts that last a season"
      : "";

  const waterNote =
    trail.waterCrossings > 0 && (prior ?? 0) > 0.5
      ? `${trail.waterCrossings} stream crossing${trail.waterCrossings > 1 ? "s" : ""} will be running high`
      : "";

  return {
    id: "surface",
    label: "Trail surface",
    score,
    weight: 0,
    display: surfaceState(snowIn, wetness),
    // Joined as sentences. Concatenating the notes directly produced
    // "Dry and firm rock 1 stream crossing will be running high".
    reason: [reason, rutNote, waterNote].filter((part) => part.length > 0).join(". "),
    sources: collect(conditions, ["precipitationPrior72hIn", "snowDepthIn"]),
  };
};

// ---------------------------------------------------------------------------
// Rock condition (climbing only)
// ---------------------------------------------------------------------------

/**
 * Hours a rock type needs after measurable rain before it is worth climbing.
 *
 * `veto` is the hard floor. For desert sandstone this is not a comfort
 * threshold but an ethics and safety one: western sandstone can lose up to
 * 75% of its strength while saturated, so climbing it wet snaps holds and
 * permanently destroys routes. The Access Fund's guidance is 24-48 hours
 * minimum, longer when it is cool or humid, which is why the veto sits at 48
 * and the score does not reach full until 96.
 */
const ROCK_DRYING: Record<
  NonNullable<Trail["rockType"]>,
  { veto: number; good: number; label: string }
> = {
  sandstone: { veto: 48, good: 96, label: "sandstone" },
  conglomerate: { veto: 18, good: 48, label: "conglomerate" },
  limestone: { veto: 8, good: 30, label: "limestone" },
  quartzite: { veto: 6, good: 24, label: "quartzite" },
  basalt: { veto: 4, good: 18, label: "basalt" },
  granite: { veto: 4, good: 16, label: "granite" },
};

/** North-facing and shaded rock sheds water far more slowly. */
function dryingPenalty(trail: Trail): number {
  const slowAspect = trail.aspect === "N" || trail.aspect === "NE" || trail.aspect === "NW";
  const shade = trail.exposed ? 1 : 1.25;
  return (slowAspect ? 1.3 : 1) * shade;
}

export const rockRule: Rule = ({ trail, conditions }) => {
  const rock = trail.rockType;
  if (!rock) {
    return missing("rock", "Rock condition", "No rock type recorded for this area");
  }

  const spec = ROCK_DRYING[rock];
  const factor = dryingPenalty(trail);
  const vetoHours = spec.veto * factor;
  const goodHours = spec.good * factor;

  const since = conditions.hoursSincePrecip;
  const todayRain = conditions.precipitationIn ?? 0;

  // Rain forecast for the day itself ends the question.
  if (todayRain >= 0.05) {
    return {
      id: "rock",
      label: "Rock condition",
      score: 0,
      weight: 0,
      display: `${todayRain.toFixed(2)} in today`,
      reason: `Rain forecast today — ${spec.label} will be wet${rock === "sandstone" ? "; climbing saturated sandstone breaks holds" : ""}`,
      veto: rock === "sandstone",
      sources: collect(conditions, ["precipitationIn", "hoursSincePrecip"]),
    };
  }

  if (since === undefined) {
    // No wet hour in the 96-hour lookback: the rock is as dry as it gets.
    return {
      id: "rock",
      label: "Rock condition",
      score: 100,
      weight: 0,
      display: "4+ days dry",
      reason: `Dry ${spec.label}; no rain in at least four days`,
      sources: collect(conditions, ["precipitationPrior72hIn", "hoursSincePrecip"]),
    };
  }

  const score = between(since, vetoHours * 0.5, goodHours, 0, 100);
  const veto = since < vetoHours;

  let reason: string;
  if (veto && rock === "sandstone") {
    reason = `Only ${Math.round(since)} h since rain. Wet sandstone loses up to 75% of its strength — climbing it now snaps holds and destroys routes. Wait ${Math.round(vetoHours - since)} h more.`;
  } else if (veto) {
    reason = `Only ${Math.round(since)} h since rain; ${spec.label} will still be damp or seeping`;
  } else if (score < 70) {
    reason = `${Math.round(since)} h since rain — ${spec.label} is drying but may still be greasy in shaded corners`;
  } else {
    reason = `${Math.round(since)} h since rain; ${spec.label} should be dry`;
  }

  // Say so when the rock type is a regional inference rather than a verified
  // fact. The veto still fires -- on the Colorado Plateau the conservative
  // error is telling someone to wait -- but the user should know which it is.
  const inferred =
    trail.rockTypeSource === "inferred" ? " (rock type inferred from the region)" : "";

  return {
    id: "rock",
    label: "Rock condition",
    score,
    weight: 0,
    display: `${Math.round(since)} h dry`,
    reason: reason + inferred,
    veto,
    sources: collect(conditions, ["hoursSincePrecip", "precipitationPrior72hIn"]),
  };
};

// ---------------------------------------------------------------------------
// Water (fishing only)
// ---------------------------------------------------------------------------

/**
 * Water temperature, and the rule that matters most here.
 *
 * Trout feed best in the low 50s to low 60s F. Above about 68 F, warm water
 * holds too little dissolved oxygen for a fish to recover from being played,
 * and a released trout frequently dies anyway. Western states impose "hoot
 * owl" restrictions on exactly this basis, closing rivers to afternoon
 * angling during warm spells.
 *
 * So this veto is not about whether you will catch anything. You probably
 * will. It is about what happens to the fish afterwards, which is the sort of
 * judgement a conditions app is well placed to make and an angler staring at
 * a pretty river is not.
 */
export const waterTempRule: Rule = ({ conditions }) => {
  const temp = conditions.waterTempF;
  if (temp === undefined) {
    return missing(
      "water_temp",
      "Water temperature",
      "No gauge reporting water temperature within 25 mi",
    );
  }

  let score: number;
  if (temp >= 50 && temp <= 63) score = 100;
  else if (temp > 63) score = clamp(100 - (temp - 63) * 12);
  else score = clamp(100 - (50 - temp) * 3.5);

  const veto = temp >= 68;

  let reason: string;
  if (veto) {
    reason = `${round(temp)} \u00b0F is too warm to fish ethically \u2014 trout played in water this warm often die after release. Fish at dawn or find higher, colder water.`;
  } else if (temp >= 65) {
    reason = `${round(temp)} \u00b0F and climbing; fish early and release quickly`;
  } else if (temp < 42) {
    reason = `${round(temp)} \u00b0F \u2014 cold and slow; fish deep and expect a short window`;
  } else {
    reason = `${round(temp)} \u00b0F, in the band trout feed hardest in`;
  }

  return {
    id: "water_temp",
    label: "Water temperature",
    score,
    weight: 0,
    display: `${round(temp)} \u00b0F`,
    reason,
    veto,
    sources: collect(conditions, ["waterTempF"]),
  };
};

/**
 * Flow and clarity.
 *
 * A gauge gives discharge but not turbidity, and turbidity is what actually
 * ruins a day. Recent rain is the best proxy available: runoff colours a
 * river long before it changes the number on the gauge, so the two are read
 * together rather than the flow figure being trusted alone.
 */
export const waterFlowRule: Rule = ({ conditions }) => {
  const flow = conditions.streamflowCfs;
  const recentRain = conditions.precipitationPrior72hIn;

  if (flow === undefined && recentRain === undefined) {
    return missing("water_flow", "Flow and clarity", "No gauge or rainfall history available");
  }

  let score = 100;
  const notes: string[] = [];

  if (recentRain !== undefined) {
    // Heavy recent rain means off-colour water whatever the gauge says.
    score -= Math.min(70, recentRain * 90);
    if (recentRain > 0.6) notes.push(`${recentRain.toFixed(2)} in of rain over the last 3 days will have coloured it`);
    else if (recentRain > 0.2) notes.push(`${recentRain.toFixed(2)} in of recent rain; expect some stain`);
  }

  if (flow !== undefined) {
    if (flow < 10) {
      score -= 25;
      notes.push(`very low flow at ${flow.toFixed(0)} cfs \u2014 spooky fish, wade carefully`);
    } else {
      notes.push(`${flow.toFixed(0)} cfs at the nearest gauge`);
    }
  }

  const gauge = conditions.gaugeDistanceMi;
  if (flow !== undefined && gauge !== undefined && gauge > 12) {
    notes.push(`gauge is ${gauge.toFixed(0)} mi off, so treat it as indicative`);
  }

  return {
    id: "water_flow",
    label: "Flow and clarity",
    score: clamp(score),
    weight: 0,
    display: flow !== undefined ? `${flow.toFixed(0)} cfs` : `${(recentRain ?? 0).toFixed(2)} in rain`,
    reason: notes.length > 0 ? notes.join("; ") : "Stable water",
    sources: collect(conditions, ["streamflowCfs", "precipitationPrior72hIn"]),
  };
};

/**
 * Barometric trend. Falling pressure ahead of a front is the classic feeding
 * window; a sharp rise behind one is the classic dead day. The effect is real
 * but modest, which is why it carries a small weight rather than a veto.
 */
export const pressureRule: Rule = ({ conditions }) => {
  const change = conditions.pressureChangeHpa;
  if (change === undefined) {
    return missing("pressure", "Barometric trend", "No pressure history available");
  }

  let score: number;
  if (change <= -3) score = 100;
  else if (change < 0) score = between(change, 0, -3, 72, 100);
  else score = clamp(72 - change * 7);

  let reason: string;
  if (change <= -3) reason = `Falling hard (${change.toFixed(1)} hPa in 24 h) \u2014 prime feeding window`;
  else if (change < -0.5) reason = `Easing off (${change.toFixed(1)} hPa) \u2014 a good sign`;
  else if (change > 4) reason = `Rising sharply (+${change.toFixed(1)} hPa) behind a front; expect a slow bite`;
  else reason = `Steady (${change >= 0 ? "+" : ""}${change.toFixed(1)} hPa)`;

  return {
    id: "pressure",
    label: "Barometric trend",
    score,
    weight: 0,
    display: `${change >= 0 ? "+" : ""}${change.toFixed(1)} hPa`,
    reason,
    sources: collect(conditions, ["pressureChangeHpa", "pressureHpa"]),
  };
};

// ---------------------------------------------------------------------------
// Wildfire
// ---------------------------------------------------------------------------

/**
 * Wildfire, read together with air quality.
 *
 * Distance alone is a poor proxy for whether a fire affects your day. A fire
 * four miles away means closures regardless of wind; a fire ninety miles away
 * matters only if its smoke is reaching you. Air quality measures that
 * directly, so this rule scores distant fires gently and lets the AQI factor
 * carry the smoke itself -- scoring both heavily would count the same smoke
 * twice. What this rule adds is the *explanation*: when the air is bad and
 * there is a fire in range, it says which fire is the likely cause.
 */
export const wildfireRule: Rule = ({ conditions }) => {
  const fires = conditions.wildfires;
  if (fires === undefined) {
    return missing("wildfire", "Wildfire", "No wildfire perimeter data available");
  }

  const aqi = conditions.usAqi;

  if (fires.length === 0) {
    return {
      id: "wildfire",
      label: "Wildfire",
      score: 100,
      weight: 0,
      display: "none within 100 mi",
      reason: "No active fire perimeters within 100 miles",
      sources: collect(conditions, ["wildfires"]),
    };
  }

  const nearest = fires[0];
  if (!nearest) {
    return missing("wildfire", "Wildfire", "No wildfire perimeter data available");
  }

  const distance = nearest.distanceMi;

  let score: number;
  if (distance <= 5) score = 0;
  else if (distance <= 15) score = between(distance, 5, 15, 15, 45);
  else if (distance <= 40) score = between(distance, 15, 40, 45, 80);
  else score = between(distance, 40, 100, 80, 95);

  const veto = distance <= 5;
  const acres = nearest.acres !== undefined ? ` (~${nearest.acres.toLocaleString()} acres)` : "";
  const others = fires.length > 1 ? `, plus ${fires.length - 1} more in range` : "";

  let reason: string;
  if (veto) {
    reason = `${nearest.name} fire ${distance.toFixed(1)} mi away${acres} \u2014 expect closures and evacuations`;
  } else if (aqi !== undefined && aqi > 100) {
    // The cross-factor sentence is the point of reading these together.
    reason = `${nearest.name} fire ${distance.toFixed(0)} mi away${acres}${others}; with AQI at ${Math.round(aqi)}, its smoke is likely what you are breathing`;
  } else if (aqi !== undefined) {
    reason = `${nearest.name} fire ${distance.toFixed(0)} mi away${acres}${others}; air is clean for now (AQI ${Math.round(aqi)}), but that can change with the wind`;
  } else {
    reason = `${nearest.name} fire ${distance.toFixed(0)} mi away${acres}${others}; smoke possible depending on wind`;
  }

  return {
    id: "wildfire",
    label: "Wildfire",
    score,
    weight: 0,
    display: `${distance.toFixed(0)} mi away`,
    reason,
    veto,
    sources: collect(conditions, ["wildfires", "usAqi"]),
  };
};

export const RULES: Record<FactorId, Rule> = {
  temperature: temperatureRule,
  precipitation: precipitationRule,
  wind: windRule,
  air_quality: airQualityRule,
  daylight: daylightRule,
  surface: surfaceRule,
  rock: rockRule,
  water_temp: waterTempRule,
  water_flow: waterFlowRule,
  pressure: pressureRule,
  wildfire: wildfireRule,
};
