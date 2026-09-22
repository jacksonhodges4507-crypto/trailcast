"use client";

import { SPECIES, SPECIES_IDS, type SpeciesId } from "@/lib/fishing/species";
import { allWatersFor } from "@/lib/fishing/guide";
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
              `${SPECIES_IDS.length} species across ${new Set(SPECIES_IDS.flatMap(allWatersFor)).size} waters`
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

            <figure className="dex-photo">
              <img src={species.photo.src} alt={`${species.name}, photographed`} loading="lazy" />
              <figcaption>
                Photo: {species.photo.credit} ·{" "}
                <a href={species.photo.page} target="_blank" rel="noreferrer noopener">
                  {species.photo.license}
                </a>
                {species.photo.caveat ? <span>{species.photo.caveat}</span> : null}
              </figcaption>
            </figure>

            <div className="dex-hero">
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
                {allWatersFor(species.id).slice(0, 24).map((id) => {
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
              {allWatersFor(species.id).length > 24 ? (
                <p className="fish-note">
                  Showing the 24 best-stocked of {allWatersFor(species.id).length} Utah waters that hold this
                  fish. Search the map for more.
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <div className="dex-grid">
            {SPECIES_IDS.map((id) => {
              const s = SPECIES[id];
              return (
                <button key={id} type="button" className="dex-card" onClick={() => onFocus(id)}>
                  <img className="dex-thumb" src={s.photo.src} alt="" loading="lazy" />
                  <strong>{s.name}</strong>
                  <span className={s.native ? "dex-badge native" : "dex-badge"}>
                    {s.native ? "Native" : "Introduced"}
                  </span>
                  <em>
                    {allWatersFor(id).length} water{allWatersFor(id).length === 1 ? "" : "s"}
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
