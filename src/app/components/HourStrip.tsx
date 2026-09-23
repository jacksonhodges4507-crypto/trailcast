"use client";

import type { HourPoint } from "@/lib/types";

/**
 * The day, hour by hour.
 *
 * A daily high answers "is it hot today". Someone who will be on the trail
 * from seven until two is asking something else: when does the wind get up,
 * and when does the rain arrive. The score cannot say that, and neither can
 * a single number — only the shape of the day can, which is why this sits
 * directly under the verdict rather than at the bottom with the sources.
 *
 * Drawn from the same hourly readings the score is built from, so the strip
 * and the verdict can never disagree.
 */

export interface HourStripProps {
  hours: HourPoint[];
  /** Local sunrise and sunset, "HH:MM", to shade the dark hours. */
  sunrise?: string;
  sunset?: string;
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

/** Warm for hot, cool for cold — the same ramp the map pins use. */
function tempColor(f: number): string {
  if (f <= 20) return "#4f6b9e";
  if (f <= 35) return "#6f91b8";
  if (f <= 50) return "#7fa3a0";
  if (f <= 65) return "#6b7f4e";
  if (f <= 78) return "#a8952f";
  if (f <= 90) return "#c8751e";
  return "#b23a1e";
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

  // One sentence of what the shape actually means, so the strip is not just
  // decoration for someone who does not want to read a chart.
  const notes: string[] = [];
  if (wettest && (wettest.precipChancePct ?? 0) >= 35) {
    notes.push(
      `Best chance of rain is around ${hourLabel(wettest.hour)} at ${Math.round(wettest.precipChancePct as number)}%`,
    );
  }
  if (windiest && (windiest.windMph ?? 0) >= 15) {
    notes.push(`wind peaks near ${hourLabel(windiest.hour)} at ${Math.round(windiest.windMph as number)} mph`);
  }
  if (notes.length === 0) notes.push("No rain or wind spike stands out — the day holds fairly steady");

  return (
    <section className="hours">
      <div className="hours-head">
        <h3>Through the day</h3>
        <span>
          {Math.round(low)}° to {Math.round(high)}°
        </span>
      </div>

      <div className="hours-strip" role="img" aria-label={`Hourly forecast, ${notes.join(", ")}`}>
        {usable.map((h) => {
          const temp = h.tempF as number;
          const height = 18 + ((temp - low) / span) * 40;
          const rain = h.precipChancePct ?? 0;
          const dark =
            (riseHour !== null && h.hour < riseHour) || (setHour !== null && h.hour > setHour);
          return (
            <div className={dark ? "hour dark" : "hour"} key={h.hour}>
              <span className="hour-temp">{Math.round(temp)}°</span>
              <span className="hour-bar-wrap">
                {rain > 0 ? (
                  <span className="hour-rain" style={{ height: `${Math.min(100, rain)}%` }} />
                ) : null}
                <span
                  className="hour-bar"
                  style={{ height: `${height}px`, background: tempColor(temp) }}
                />
              </span>
              <span className="hour-rainpct">{rain >= 15 ? `${Math.round(rain)}%` : ""}</span>
              <span className="hour-label">{hourLabel(h.hour)}</span>
            </div>
          );
        })}
      </div>

      <p className="hours-note">{notes.join(", and ")}.</p>
      <span className="hours-foot">
        Bars are temperature; the pale column behind each is the chance of rain that hour. Shaded
        hours are before sunrise or after sunset.
      </span>
    </section>
  );
}
