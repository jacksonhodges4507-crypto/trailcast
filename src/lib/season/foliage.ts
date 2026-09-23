import type { Trail } from "../types";

/**
 * When the leaves turn, and whether you have missed them.
 *
 * Fall colour in Utah runs downhill. Aspen at 9,500 ft is past peak while
 * the Wasatch maples at 6,000 ft have not started, which is why "when is
 * peak colour in Utah" has no single answer and why a date alone is useless
 * to somebody choosing where to drive this weekend.
 *
 * The model is elevation and date, and nothing else. It is a rule of thumb
 * with real structure behind it -- colour descends roughly a thousand feet
 * every four or five days, from about 18 September at 9,500 ft -- and it is
 * labelled as an estimate everywhere it is shown, because a cold snap or a
 * dry August moves it by a week and no forecast knows that in advance.
 *
 * Deliberately not part of the score. A trail is not safer because the
 * leaves are out, and burying a subjective preference inside a conditions
 * number would make the number mean less.
 */

/** Below this, a trail is desert or valley floor: no aspen, no maple show. */
const LOWEST_COLOR_FT = 5200;

/** Peak at this elevation, as a day-of-year (18 September). */
const ANCHOR_FT = 9500;
const ANCHOR_DOY = 261;

/** Days peak slips later for every 1,000 ft you drop. */
const DAYS_PER_1000FT = 4.5;

/** Either side of peak, leaves are still worth the drive. */
const SHOULDER_DAYS = 7;

export type FoliageStatus = "too-early" | "turning" | "peak" | "fading" | "past" | "none";

export interface Foliage {
  status: FoliageStatus;
  /** Estimated peak date, ISO. */
  peak: string;
  /** Days from the date asked about to peak; negative means peak has passed. */
  daysToPeak: number;
  /** One sentence for the panel and for Scout. */
  note: string;
  /** 0-100, for ranking when somebody asks for colour. Null off-season. */
  rating: number | null;
}

function dayOfYear(iso: string): number {
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return 0;
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.round((date.getTime() - start) / 86_400_000) + 1;
}

function isoFromDayOfYear(year: number, doy: number): string {
  const date = new Date(Date.UTC(year, 0, 1) + (doy - 1) * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function prettyDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

/** The estimated peak-colour day of the year at an elevation. */
export function peakDayOfYear(elevationFt: number): number {
  const drop = (ANCHOR_FT - elevationFt) / 1000;
  return Math.round(ANCHOR_DOY + drop * DAYS_PER_1000FT);
}

export function foliageFor(trail: Trail, isoDate: string): Foliage | null {
  // Fishing waters and crags are not what this question is about, and an
  // elevation of zero means the importer never had one.
  if (trail.elevationFt <= 0) return null;
  if (!trail.activities.some((a) => a === "hike" || a === "trail_run" || a === "mtb")) return null;

  const year = Number(isoDate.slice(0, 4));
  const today = dayOfYear(isoDate);
  if (!Number.isFinite(year) || today === 0) return null;

  if (trail.elevationFt < LOWEST_COLOR_FT) {
    return {
      status: "none",
      peak: "",
      daysToPeak: 0,
      rating: null,
      note: `At ${trail.elevationFt.toLocaleString()} ft this is desert and valley country — pretty in its own way, but it doesn't do fall colour.`,
    };
  }

  const peakDoy = peakDayOfYear(trail.elevationFt);
  const delta = peakDoy - today;
  const peak = isoFromDayOfYear(year, peakDoy);
  const away = Math.abs(delta);

  let status: FoliageStatus;
  let rating: number | null;
  let note: string;

  if (delta > 45 || delta < -45) {
    status = delta > 0 ? "too-early" : "past";
    rating = null;
    note =
      delta > 0
        ? `Nothing to see yet — the aspens up here usually turn around ${prettyDate(peak)}.`
        : `Leaves came and went around ${prettyDate(peak)}; this is a next-September trip.`;
  } else if (away <= 3) {
    status = "peak";
    rating = 100;
    note = `Should be at or near peak — around ${prettyDate(peak)} is when ${trail.elevationFt.toLocaleString()} ft usually turns.`;
  } else if (delta > 0 && delta <= SHOULDER_DAYS * 2) {
    status = "turning";
    rating = Math.round(100 - delta * 4);
    note = `Starting to turn. Peak up here is usually about ${prettyDate(peak)}, so you're ${delta} day${delta === 1 ? "" : "s"} early.`;
  } else if (delta < 0 && away <= SHOULDER_DAYS * 2) {
    status = "fading";
    rating = Math.round(100 - away * 6);
    note = `Past its best — peak was around ${prettyDate(peak)}, ${away} day${away === 1 ? "" : "s"} ago. Still colour on the ground and at lower elevations.`;
  } else {
    status = delta > 0 ? "too-early" : "past";
    rating = Math.max(0, Math.round(60 - away * 2));
    note =
      delta > 0
        ? `Still green. Colour at ${trail.elevationFt.toLocaleString()} ft usually peaks around ${prettyDate(peak)}.`
        : `The show here finished around ${prettyDate(peak)}. Try lower — colour drops about a thousand feet a week.`;
  }

  return { status, peak, daysToPeak: delta, rating, note };
}

/** True during the months the panel is worth showing at all. */
export function isFoliageSeason(isoDate: string): boolean {
  const month = Number(isoDate.slice(5, 7));
  return month === 9 || month === 10 || month === 11;
}
