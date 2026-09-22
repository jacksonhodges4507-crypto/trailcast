"use client";

import { SPECIES, SPECIES_IDS, type SpeciesId } from "@/lib/fishing/species";
import { watersFor } from "@/lib/fishing/guide";
import { getTrail } from "@/lib/trails";

export interface FishDexProps {
  focus: SpeciesId | null;
  onFocus: (id: SpeciesId | null) => void;
  onSelectWater: (trailId: string) => void;
  onClose: () => void;
}

/**
 * Every species across TrailCast's waters, and where to find each.
 *
 * Opens in the same right-hand column as a water's detail, so the map stays
 * in view. Tapping a water from a species jumps straight to that water.
 */
export default function FishDex({ focus, onFocus, onSelectWater, onClose }: FishDexProps) {
  const species = focus ? SPECIES[focus] : null;

  return (
    <aside className="detail">
      <div className="detail-head">
        <div>
          <h2>{species ? species.name : "Fish Dex"}</h2>
          <div className="card-region">
            {species ? (
              <em>{species.scientific}</em>
            ) : (
              `${SPECIES_IDS.length} species across ${new Set(SPECIES_IDS.flatMap(watersFor)).size} waters`
            )}
          </div>
        </div>
        <button className="detail-close" onClick={onClose} aria-label="Close Fish Dex">
          ×
        </button>
      </div>

      <div className="detail-body">
        {species ? (
          <>
            <button type="button" className="dex-back" onClick={() => onFocus(null)}>
              ← All species
            </button>

            <div className="dex-hero">
              <span className="dex-glyph" aria-hidden>
                {species.glyph}
              </span>
              <span className={species.native ? "dex-badge native" : "dex-badge"}>
                {species.native ? "Native to Utah" : "Introduced"}
              </span>
            </div>

            <div className="fish-block">
              <div className="fish-label">How to identify it</div>
              <p className="dex-text">{species.identify}</p>
            </div>

            <div className="dex-facts">
              <div>
                <span>Typical size</span>
                {species.typicalSize}
              </div>
              <div>
                <span>Spawns</span>
                {species.spawns}
              </div>
            </div>

            <div className="fish-block">
              <div className="fish-label">Habits</div>
              <p className="dex-text">{species.habits}</p>
            </div>

            {species.note ? <p className="fish-note">{species.note}</p> : null}

            <div className="fish-block">
              <div className="fish-label">Where to find it</div>
              <div className="fish-species">
                {watersFor(species.id).map((id) => {
                  const water = getTrail(id);
                  if (!water) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      className="species-chip"
                      onClick={() => onSelectWater(id)}
                    >
                      {water.name}
                      <em>{water.region}</em>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="dex-grid">
            {SPECIES_IDS.map((id) => {
              const s = SPECIES[id];
              return (
                <button key={id} type="button" className="dex-card" onClick={() => onFocus(id)}>
                  <span className="dex-glyph" aria-hidden>
                    {s.glyph}
                  </span>
                  <strong>{s.name}</strong>
                  <span className={s.native ? "dex-badge native" : "dex-badge"}>
                    {s.native ? "Native" : "Introduced"}
                  </span>
                  <em>
                    {watersFor(id).length} water{watersFor(id).length === 1 ? "" : "s"}
                  </em>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
