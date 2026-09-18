/**
 * Date handling is deliberately timezone-explicit. "Saturday" means Saturday
 * where the trail is, not where the server happens to be running, and on
 * Vercel the server is running in UTC.
 */

export const DEFAULT_TIMEZONE = "America/Denver";

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/** Today's date as YYYY-MM-DD in the given IANA timezone. */
export function todayIso(timezone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA yields YYYY-MM-DD.
  return formatter.format(now);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const shifted = new Date(base + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/** Day of week index (0 = Sunday) for an ISO date, timezone-independent. */
export function weekdayIndex(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

export function weekdayName(isoDate: string): string {
  const name = WEEKDAYS[weekdayIndex(isoDate)] ?? "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Human label: "today", "tomorrow", or "Saturday". */
export function relativeLabel(isoDate: string, today: string): string {
  if (isoDate === today) return "today";
  if (isoDate === addDays(today, 1)) return "tomorrow";
  return weekdayName(isoDate);
}

/** How far ahead the weather models we use stay meaningful. */
export const MAX_FORECAST_DAYS = 6;

export function isWithinForecastWindow(isoDate: string, today: string): boolean {
  for (let i = 0; i <= MAX_FORECAST_DAYS; i += 1) {
    if (addDays(today, i) === isoDate) return true;
  }
  return false;
}

export function forecastWindow(today: string): string[] {
  return Array.from({ length: MAX_FORECAST_DAYS + 1 }, (_, i) => addDays(today, i));
}

/**
 * Resolve a natural-language day reference against a reference date.
 * Returns null when nothing in the phrase looks like a day.
 */
export function resolveDatePhrase(phrase: string, today: string): string | null {
  const text = phrase.toLowerCase();

  const explicit = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicit?.[1]) return explicit[1];

  if (/\btoday\b|\bright now\b|\bthis morning\b|\bthis afternoon\b/.test(text)) return today;
  if (/\btomorrow\b/.test(text)) return addDays(today, 1);
  if (/\bday after tomorrow\b/.test(text)) return addDays(today, 2);

  if (/\bweekend\b/.test(text)) {
    // The next Saturday, or today if today is already the weekend.
    const todayIdx = weekdayIndex(today);
    if (todayIdx === 6 || todayIdx === 0) return today;
    return addDays(today, (6 - todayIdx + 7) % 7);
  }

  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    const name = WEEKDAYS[i];
    if (!name) continue;
    if (!new RegExp(`\\b${name}\\b`).test(text)) continue;

    const todayIdx = weekdayIndex(today);
    let delta = (i - todayIdx + 7) % 7;
    // "on monday" when today is Monday means today; "next monday" means +7.
    if (delta === 0 && /\bnext\b/.test(text)) delta = 7;
    return addDays(today, delta);
  }

  return null;
}
