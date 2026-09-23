"use client";

import type { HourPoint } from "@/lib/types";

/**
 * The day, hour by hour.
 *
 * A daily high answers "is it hot today". Somebody out from seven until two
 * is asking something else -- when does the wind get up, when does the rain
 * arrive -- and only the shape of the day answers that.
 *
 * Four things are encoded at once here, which is three more than a reader
 * should have to infer, so every one of them is named in the key below and
 * the exact numbers are one hover away. Temperature is drawn twice, as bar
 * height and as colour: the redundancy is deliberate, so the strip still
 * reads correctly in greyscale, in print, and to a colourblind reader.
 *
 * Drawn from the same hourly readings the score is built from, so the strip
 * and the verdict can never disagree.
 */

export interface HourStripProps {
  hours: HourPoint[];
  /** Local sunrise and sunset, "HH:MM", to mark the dark hours. */
  sunrise?: string;
  sunset?: string;
}

/**
 * Five temperature bands, cold to hot.
 *
 * Checked with the palette validator rather than by eye: every adjacent pair
 * separates for protan, deutan and tritan vision as well as for normal
 * vision, against both the light and dark surfaces. Each bar also carries
 * its own number, so colour is never the only thing carrying the value.
 */
const BANDS: { upTo: number; color: string; label: string }[] = [
  { upTo: 32, color: "#2f4a7a", label: "Freezing" },
  { upTo: 50, color: "#6f9ac4", label: "Cold" },
  { upTo: 70, color: "#6b7f4e", label: "Mild" },
  { upTo: 85, color: "#d9954a", label: "Warm" },
  { upTo: Infinity, color: "#b23a1e", label: "Hot" },
];

const RAIN = "#4f6b9e";

function bandFor(f: number): { color: string; label: string } {
  for (const band of BANDS) if (f <= band.upTo) return band;
  return BANDS[BANDS.length - 1]!;
}

function hourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

function parseHour(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(\d{1,2}):(\d{2})/);
  const hour = match?.[1];
  return hour ? Number(hour) : null;
}

/** Everything known about one hour, for the hover. */
function tooltip(h: HourPoint): string {
  const parts = [hourLabel(h.hour)];
  if (h.tempF !== undefined) parts.push(`${Math.round(h.tempF)}°F`);
  if (h.precipChancePct !== undefined) parts.push(`${Math.round(h.precipChancePct)}% chance of rain`);
  if (h.windMph !== undefined) {
    const gust =
      h.gustMph !== undefined && h.gustMph - h.windMph >= 5
        ? `, gusting ${Math.round(h.gustMph)}`
        : "";
    parts.push(`wind ${Math.round(h.windMph)} mph${gust}`);
  }
  if (h.cloudPct !== undefined) parts.push(`${Math.round(h.cloudPct)}% cloud`);
  return parts.join(" · ");
}

export default function HourStrip({ hours, sunrise, sunset }: HourStripProps) {
  const usable = hours.filter((h) => h.tempF !== undefined);
  if (usable.length < 3) return null;

  const temps = usable.map((h) => h.tempF as number);
  const low = Math.min(...temps);
  const high = Math.max(...temps);
  const span = Math.max(6, high - low);

  const riseHour = parseHour(sunrise);
  const setHour = parseHour(sunset);

  const wettest = usable.reduce(
    (worst, h) => ((h.precipChancePct ?? 0) > (worst?.precipChancePct ?? 0) ? h : worst),
    undefined as HourPoint | undefined,
  );
  const windiest = usable.reduce(
    (worst, h) => ((h.windMph ?? 0) > (worst?.windMph ?? 0) ? h : worst),
    undefined as HourPoint | undefined,
  );
  const warmest = usable.reduce((best, h) =>
    (h.tempF as number) > (best.tempF as number) ? h : best,
  );

  // The plain-English version, for anyone who does not want to read a chart.
  const notes: string[] = [`Warmest around ${hourLabel(warmest.hour)}`];
  if (wettest && (wettest.precipChancePct ?? 0) >= 35) {
    notes.push(
      `best chance of rain near ${hourLabel(wettest.hour)} at ${Math.round(wettest.precipChancePct as number)}%`,
    );
  }
  if (windiest && (windiest.windMph ?? 0) >= 15) {
    notes.push(
      `wind peaks near ${hourLabel(windiest.hour)} at ${Math.round(windiest.windMph as number)} mph`,
    );
  }
  if (notes.length === 1) notes.push("no rain or wind spike stands out");

  // Only the bands this day actually reaches, so the key stays short.
  const usedBands = BANDS.filter((band) =>
    usable.some((h) => bandFor(h.tempF as number).label === band.label),
  );
  const anyRain = usable.some((h) => (h.precipChancePct ?? 0) >= 5);
  const anyDark = usable.some(
    (h) => (riseHour !== null && h.hour < riseHour) || (setHour !== null && h.hour > setHour),
  );

  return (
    <section className="hours">
      <div className="hours-head">
        <h3>Through the day</h3>
        <span>
          {Math.round(low)}° to {Math.round(high)}°
        </span>
      </div>

      <p className="hours-note">{notes.join(", ")}.</p>

      <div className="hours-strip">
        {usable.map((h) => {
          const temp = h.tempF as number;
          const height = 18 + ((temp - low) / span) * 40;
          const rain = h.precipChancePct ?? 0;
          const dark =
            (riseHour !== null && h.hour < riseHour) || (setHour !== null && h.hour > setHour);
          return (
            <div className={dark ? "hour dark" : "hour"} key={h.hour} title={tooltip(h)}>
              <span className="hour-temp">{Math.round(temp)}°</span>
              <span className="hour-bar-wrap">
                {rain > 0 ? (
                  <span className="hour-rain" style={{ height: `${Math.min(100, rain)}%` }} />
                ) : null}
                <span
                  className="hour-bar"
                  style={{ height: `${height}px`, background: bandFor(temp).color }}
                />
              </span>
              <span className="hour-rainpct">{rain >= 15 ? `${Math.round(rain)}%` : ""}</span>
              <span className="hour-label">{hourLabel(h.hour)}</span>
            </div>
          );
        })}
      </div>

      <dl className="hours-key">
        <div className="hours-key-row">
          <dt>
            <span className="key-bar" aria-hidden /> Bar height and colour
          </dt>
          <dd>
            Temperature. The number above each bar is that hour in °F.
            <span className="key-scale">
              {usedBands.map((band) => (
                <span key={band.label}>
                  <i style={{ background: band.color }} aria-hidden />
                  {band.label}
                </span>
              ))}
            </span>
          </dd>
        </div>

        {anyRain ? (
          <div className="hours-key-row">
            <dt>
              <span className="key-rain" aria-hidden /> Pale column behind
            </dt>
            <dd>
              Chance of rain that hour — a full-height column is 100%. The percentage is printed
              under the bar once it passes 15%.
            </dd>
          </div>
        ) : null}

        {anyDark ? (
          <div className="hours-key-row">
            <dt>
              <span className="key-dim" aria-hidden /> Faded hours
            </dt>
            <dd>Before sunrise or after sunset.</dd>
          </div>
        ) : null}

        <div className="hours-key-row">
          <dt>
            <span className="key-hover" aria-hidden>
              ⌖
            </span>{" "}
            Hover an hour
          </dt>
          <dd>Exact temperature, rain chance, wind, gusts and cloud for that hour.</dd>
        </div>
      </dl>

      <span className="hours-foot">
        Hourly readings from Open-Meteo — the same ones the score above is built from. Wind is not
        drawn here; it is in the hover and in the wind factor below.
      </span>
    </section>
  );
}
