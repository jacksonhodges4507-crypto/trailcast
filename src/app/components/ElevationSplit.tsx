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
          <span className="elev-split-wind">{wind(conditions.windMph)}</span>
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
          <span className="elev-split-wind">{wind(summit.windMph)}</span>
        </div>
      </div>

      {gap ? <p className="elev-split-note">{gap}</p> : null}

      {conditions.precipitationChancePct !== undefined ? (
        <p className="elev-split-shared">
          Rain {Math.round(conditions.precipitationChancePct)}% — the forecast does not separate
          precipitation by elevation here, so this is the figure for the whole canyon.
        </p>
      ) : null}

      <p className="elev-split-foot">
        Summit temperature is the trailhead forecast shifted by the measured difference between
        those two heights; summit wind is the free-air wind at ridge level, which is what a
        mountain forecast reads. Both are estimates for the top of the route, not a reading taken
        there.
      </p>
    </section>
  );
}
