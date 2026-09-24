import type { AirProfile, Conditions, Trail } from "./types";

/**
 * What it is like at the top, as opposed to where you park.
 *
 * A 4,000 ft climb is a different day at each end. The trailhead can be
 * pleasant while the ridge is twenty degrees colder and in a wind that makes
 * it feel worse, and a forecast quoted for the parking lot is the reason
 * people summit in a t-shirt and come down cold. This module answers the
 * question the trailhead number cannot.
 *
 * Two decisions here are load-bearing, and both were made after looking at
 * what the data actually does.
 *
 * FIRST: the summit temperature is the surface forecast plus a difference
 * taken from the vertical profile, never the profile's own value. Open-Meteo
 * will happily downscale a forecast to an arbitrary elevation, but its
 * free-air temperature at a given height and its 2 m surface temperature at
 * that same height disagree by -8 F at dawn and +5 F mid-afternoon -- the
 * ground heats and cools far more than the air above it. Reporting the
 * free-air value as the summit temperature would import that whole diurnal
 * error. Taking only the *difference* between two heights cancels it, because
 * the offset applies at both ends.
 *
 * SECOND: the wind at the summit comes from the pressure level nearest its
 * height, not from a downscaled 10 m wind. Asked for a summit wind directly,
 * the model returns a value *lower* than the trailhead's, because 10 m wind
 * is a sheltered-surface quantity and the downscaling has no notion of an
 * exposed ridge. Telling somebody a ridge at 11,000 ft is calmer than the
 * canyon floor is not a rounding error, it is advice that gets them cold.
 * Free-air wind at ridge height is what mountain forecasters read, and it is
 * what this uses.
 *
 * The profile is real data for that grid column, so an inversion -- valley
 * colder than the peaks, which is most of a Utah winter -- comes out the
 * right way round rather than being flattened by a fixed lapse rate.
 */

export interface SummitConditions {
  /** Highest point on the route, feet. */
  elevationFt: number;
  /** Feet climbed from the trailhead. */
  gainFt: number;
  tempMaxF?: number;
  tempMinF?: number;
  /**
   * Free-air wind at ridge height, mph -- set only when it genuinely comes
   * in above the trailhead. Undefined means "no better number than the one
   * already shown", which the panel renders as a single shared figure rather
   * than the same value printed twice.
   */
  windMph?: number;
  /** How much colder the top is at its warmest, F. Positive means colder. */
  coolerByF?: number;
  /** True when the valley is the cold end -- an inversion. */
  inverted: boolean;
}

/**
 * Below this, "the summit" is not a thing anybody needs a second forecast
 * for. A lakeshore and a 200 ft roll are the same day at both ends.
 */
const MIN_GAIN_FT = 800;

/**
 * How much stronger the ridge estimate must be before it is worth stating
 * separately. Under this it is noise wearing a second number's clothes.
 */
const RIDGE_WIND_MARGIN_MPH = 2;

/** Linear interpolation through the profile, extrapolating past the ends. */
function atHeight(
  profile: AirProfile,
  heightFt: number,
  pick: (level: AirProfile["levels"][number]) => number | undefined,
): number | undefined {
  const points = profile.levels
    .map((level) => ({ ft: level.heightFt, value: pick(level) }))
    .filter((p): p is { ft: number; value: number } => typeof p.value === "number")
    .sort((a, b) => a.ft - b.ft);
  if (points.length === 0) return undefined;
  if (points.length === 1) return points[0]!.value;

  // Find the bracketing pair, or the nearest pair to extend from.
  let lower = points[0]!;
  let upper = points[points.length - 1]!;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (heightFt >= a.ft && heightFt <= b.ft) {
      lower = a;
      upper = b;
      break;
    }
    if (heightFt < points[0]!.ft) {
      lower = points[0]!;
      upper = points[1]!;
      break;
    }
    if (heightFt > points[points.length - 1]!.ft) {
      lower = points[points.length - 2]!;
      upper = points[points.length - 1]!;
      break;
    }
  }

  const span = upper.ft - lower.ft;
  if (span === 0) return lower.value;
  const t = (heightFt - lower.ft) / span;
  return lower.value + (upper.value - lower.value) * t;
}

export function summitFor(trail: Trail, conditions: Conditions): SummitConditions | null {
  const gainFt = trail.gainFt ?? 0;
  const baseFt = trail.elevationFt ?? 0;
  if (gainFt < MIN_GAIN_FT || baseFt <= 0) return null;

  const topFt = baseFt + gainFt;
  const profile = conditions.profile;
  if (!profile || profile.levels.length < 2) return null;

  const tempAtBase = atHeight(profile, baseFt, (l) => l.tempF);
  const tempAtTop = atHeight(profile, topFt, (l) => l.tempF);

  const result: SummitConditions = { elevationFt: topFt, gainFt, inverted: false };

  if (tempAtBase !== undefined && tempAtTop !== undefined) {
    // The difference, not the value. See the note at the top of this file.
    const delta = tempAtTop - tempAtBase;
    result.inverted = delta > 0;
    if (conditions.tempMaxF !== undefined) result.tempMaxF = conditions.tempMaxF + delta;
    if (conditions.tempMinF !== undefined) result.tempMinF = conditions.tempMinF + delta;
    if (result.tempMaxF !== undefined && conditions.tempMaxF !== undefined) {
      result.coolerByF = conditions.tempMaxF - result.tempMaxF;
    }
  }

  const ridgeWind = atHeight(profile, topFt, (l) => l.windMph);
  const surfaceWind = conditions.windMph;
  if (ridgeWind !== undefined) {
    // A ridge is not more sheltered than the canyon under it, so a ridge
    // value below the surface wind is not a finding -- it is the model
    // describing air the mountain is not in.
    //
    // The first version clamped those up to the surface wind, which put the
    // identical number in both columns and read as "we worked out the summit
    // wind and it happens to match". It had not. Below the margin there is
    // nothing to add, so nothing is claimed, and the panel shows one wind
    // figure covering both ends -- the same treatment precipitation gets,
    // for the same reason.
    if (surfaceWind === undefined || ridgeWind >= surfaceWind + RIDGE_WIND_MARGIN_MPH) {
      result.windMph = ridgeWind;
    }
  }

  return result;
}
