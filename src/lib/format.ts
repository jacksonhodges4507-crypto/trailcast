/**
 * Presentation helpers with no dependencies, safe to import from client
 * components. Kept apart from the ask module so that using one formatter in
 * the browser does not pull the routing, scoring and model code into the
 * client bundle along with it.
 */

/** "42 min" or "2 h 25 m". */
export function formatDrive(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

interface RouteLike {
  distanceMi: number;
  gainFt: number;
  sourceName?: string;
}

/**
 * The trail's own figures, labelled so they cannot be mistaken for distance
 * from the viewer.
 *
 * The card used to print a bare "6.9 mi" right beside the drive time, which
 * reads as "6.9 miles away" but was the trail's round-trip length. Each
 * figure now says what it measures, and for climbing and fishing the word
 * changes to what the walk actually is. Imported areas carry placeholder
 * approach figures, so they show none rather than a confident wrong number.
 */
export function routeFigures(route: RouteLike, activity: string): string[] {
  if (route.sourceName === "OpenBeta" || route.sourceName === "Utah DWR") return [];

  const miles = `${route.distanceMi} mi`;
  const gain = `${route.gainFt.toLocaleString()} ft gain`;

  if (activity === "climb") return [`${miles} approach`, gain];
  if (activity === "fish") return [`${miles} of access`];
  return [`${miles} round trip`, gain];
}

/** "31 min drive · 22 mi away" -- road miles, not straight-line. */
export function formatTrip(minutes: number, miles: number): string {
  return `${formatDrive(minutes)} drive · ${miles} mi away`;
}

interface StatSource {
  trail: {
    distanceMi: number;
    sourceName?: string;
    routes?: number;
    lastStocked?: number;
    dogs?: "yes" | "leash" | "no";
  };
  conditions: { tempMaxF?: number; windMph?: number; windGustMph?: number; precipitationChancePct?: number };
  verdict: { activity: string };
}

export interface QuickStat {
  value: string;
  label: string;
}

/**
 * The numbers someone glances at before anything else: temperature, wind,
 * chance of rain, how big the outing is, and -- because it decides whether
 * the trip happens at all -- whether the dog can come. Missing readings show
 * a dash rather than a guess, same as everywhere else.
 */
export function quickStats(report: StatSource): QuickStat[] {
  const { conditions, trail, verdict } = report;
  const dash = "—";
  const size =
    verdict.activity === "climb"
      ? { value: trail.routes ? `${trail.routes}` : dash, label: "Routes" }
      : trail.lastStocked !== undefined
        ? { value: `${trail.lastStocked}`, label: "Stocked" }
        : trail.sourceName === "OpenBeta"
          ? { value: dash, label: "Length" }
        : { value: `${trail.distanceMi} mi`, label: verdict.activity === "fish" ? "Access" : "Length" };

  return [
    { value: conditions.tempMaxF !== undefined ? `${Math.round(conditions.tempMaxF)}°F` : dash, label: "High" },
    { value: conditions.windMph !== undefined ? `${Math.round(conditions.windMph)} mph` : dash, label: "Wind" },
    {
      value: conditions.precipitationChancePct !== undefined ? `${Math.round(conditions.precipitationChancePct)}%` : dash,
      label: "Rain",
    },
    size,
    {
      value: trail.dogs ? DOG_STAT[trail.dogs] : dash,
      label: "Dogs",
    },
  ];
}

const DOG_STAT: Record<"yes" | "leash" | "no", string> = {
  yes: "OK",
  leash: "Leash",
  no: "No",
};
