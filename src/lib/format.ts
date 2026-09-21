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
