"use client";

import type { Conditions, Trail } from "@/lib/types";
import { summitFor } from "@/lib/summit";

/**
 * The day at both ends of the climb.
 *
 * A forecast quoted for the parking lot is the one people plan in, and on a
 * four-thousand-foot climb it describes somewhere they will spend twenty
 * minutes. This puts the top of the route next to it.
 *
 * Only temperature and wind appear on the summit side, and that is a
 * deliberate omission rather than an oversight. Precipitation from the model
 * is identical at both elevations -- byte for byte, every hour, which is a
 * fact about the grid resolution, not about the mountain -- so it is shown
 * once, under both, rather than printed twice to imply a difference that was
 * never computed.
 */
export default function ElevationSplit({
  trail,
  conditions,
}: {
  trail: Trail;
  conditions: Conditions;
}) {
  const summit = summitFor(trail, conditions);
  if (!summit) return null;

  const temp = (value: number | undefined) =>
    value === undefined ? "—" : `${Math.round(value)}°`;
  const wind = (value: number | undefined) =>
    value === undefined ? "—" : `${Math.round(value)} mph`;
  const feet = (value: number) => `${Math.round(value).toLocaleString()} ft`;

  // Two wind figures only when the ridge estimate actually differs. When it
  // does not, one figure covers both ends -- printing the same number twice
  // would claim a summit reading that was never obtained.
  const splitWind = summit.windMph !== undefined;

  const gap =
    summit.coolerByF !== undefined && Math.abs(summit.coolerByF) >= 3
      ? summit.inverted
        ? `The top runs about ${Math.round(Math.abs(summit.coolerByF))}° warmer than the trailhead — the cold air is sitting in the valley.`
        : `The top runs about ${Math.round(summit.coolerByF)}° colder. Carry the layer you would not wear at the car.`
      : null;

  return (
    <section className="elev-split" aria-label="Conditions at the trailhead and the summit">
      <div className="elev-split-grid">
        <div>
          <span className="elev-split-where">Trailhead</span>
          <span className="elev-split-elev">{feet(trail.elevationFt)}</span>
          <strong>{temp(conditions.tempMaxF)}</strong>
          <span className="elev-split-low">low {temp(conditions.tempMinF)}</span>
          {splitWind ? (
            <span className="elev-split-wind">{wind(conditions.windMph)}</span>
          ) : null}
        </div>
        <div className="elev-split-rise" aria-hidden>
          <span>↗</span>
          <span>{feet(summit.gainFt)}</span>
        </div>
        <div>
          <span className="elev-split-where">Summit</span>
          <span className="elev-split-elev">{feet(summit.elevationFt)}</span>
          <strong>{temp(summit.tempMaxF)}</strong>
          <span className="elev-split-low">low {temp(summit.tempMinF)}</span>
          {splitWind ? <span className="elev-split-wind">{wind(summit.windMph)}</span> : null}
        </div>
      </div>

      {gap ? <p className="elev-split-note">{gap}</p> : null}

      <p className="elev-split-shared">
        {!splitWind && conditions.windMph !== undefined
          ? `Wind ${Math.round(conditions.windMph)} mph. `
          : ""}
        {conditions.precipitationChancePct !== undefined
          ? `Rain ${Math.round(conditions.precipitationChancePct)}%. `
          : ""}
        {!splitWind || conditions.precipitationChancePct !== undefined
          ? "The forecast does not separate these by elevation today, so they cover the whole canyon."
          : ""}
      </p>

      <p className="elev-split-foot">
        Summit temperature is the trailhead forecast shifted by the measured difference between
        those two heights.{" "}
        {splitWind
          ? "Summit wind is the free-air wind at ridge level, which is what a mountain forecast reads. "
          : ""}
        An estimate for the top of the route, not a reading taken there.
      </p>
    </section>
  );
}
