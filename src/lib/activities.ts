import type { Activity, ActivityId } from "./types";

/**
 * Activity profiles. Weights encode what actually ruins a day for each
 * sport: mountain bikers care about a wet, clay trail far more than hikers
 * do; climbers care about wind and precipitation and barely about daylight
 * on a short route; trail runners feel heat harder than anyone.
 */
export const ACTIVITIES: Record<ActivityId, Activity> = {
  hike: {
    id: "hike",
    label: "Hiking",
    glyph: "🥾",
    weights: {
      temperature: 1.0,
      precipitation: 1.0,
      wind: 0.6,
      air_quality: 0.9,
      daylight: 0.8,
      surface: 0.5,
      wildfire: 1.0,
    },
  },
  trail_run: {
    id: "trail_run",
    label: "Trail running",
    glyph: "🏃",
    weights: {
      temperature: 1.4,
      precipitation: 0.8,
      wind: 0.4,
      air_quality: 1.5,
      daylight: 0.9,
      surface: 0.7,
      wildfire: 1.0,
    },
  },
  mtb: {
    id: "mtb",
    label: "Mountain biking",
    glyph: "🚵",
    weights: {
      temperature: 0.8,
      precipitation: 1.2,
      wind: 0.5,
      air_quality: 1.2,
      daylight: 0.8,
      surface: 1.6,
      wildfire: 1.0,
    },
  },
  fish: {
    id: "fish",
    label: "Fishing",
    glyph: "\ud83c\udfa3",
    weights: {
      // Water temperature leads because it carries the conservation veto:
      // a trout played in water above about 68 F often dies after release.
      water_temp: 2.0,
      water_flow: 1.8,
      wind: 1.0,
      wildfire: 1.0,
      pressure: 0.8,
      precipitation: 0.6,
      air_quality: 0.6,
      daylight: 0.6,
      temperature: 0.5,
    },
  },
  climb: {
    id: "climb",
    label: "Climbing",
    glyph: "🧗",
    weights: {
      temperature: 1.1,
      precipitation: 1.6,
      wind: 1.3,
      air_quality: 0.7,
      daylight: 0.5,
      surface: 0.4,
      rock: 2.0,
      wildfire: 1.0,
    },
  },
};

export const ACTIVITY_IDS = Object.keys(ACTIVITIES) as ActivityId[];

export function isActivityId(value: string): value is ActivityId {
  return (ACTIVITY_IDS as string[]).includes(value);
}

export function parseActivity(value: string | null | undefined): ActivityId {
  if (value && isActivityId(value)) return value;
  return "hike";
}
