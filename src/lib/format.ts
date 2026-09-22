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
  if (route.sourceName === "OpenBeta") return [];

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
