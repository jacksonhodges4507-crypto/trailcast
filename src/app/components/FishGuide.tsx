"use client";

import { fishingGuide } from "@/lib/fishing/guide";
import type { SpeciesId } from "@/lib/fishing/species";

export interface FishGuideProps {
  trailId: string;
  date: string;
  onOpenSpecies: (id: SpeciesId) => void;
}

const ABUNDANCE_LABEL = {
  primary: "main catch",
  common: "common",
  present: "present",
} as const;

/**
 * What lives here, what it is eating this month, and what to tie on.
 *
 * Static knowledge rather than live data, and presented as such: the month
 * is named, the sources are linked, and regulations come with a reminder to
 * check them, because a stale regulation is worse than none.
 */
export default function FishGuide({ trailId, date, onOpenSpecies }: FishGuideProps) {
  const guide = fishingGuide(trailId, date);
  if (!guide) return null;

  return (
    <div className="fish-guide">
      <h3>On the water in {guide.month}</h3>

      <div className="fish-block">
        <div className="fish-label">Fish here</div>
        <div className="fish-species">
          {guide.species.map((s) => (
            <button
              key={s.id}
              type="button"
              className="species-chip"
              onClick={() => onOpenSpecies(s.id)}
              title={`Open ${s.name} in the Fish Dex`}
            >
              <span aria-hidden>{s.glyph}</span> {s.name}
              <em>{ABUNDANCE_LABEL[s.abundance]}</em>
            </button>
          ))}
        </div>
      </div>

      <div className="fish-block">
        <div className="fish-label">What they are eating</div>
        <p className="fish-eating">{guide.eating.join(" \u00b7 ")}</p>
      </div>

      {guide.flies.length > 0 ? (
        <div className="fish-block">
          <div className="fish-label">Flies to try</div>
          <ul className="fish-picks">
            {guide.flies.map((fly) => (
              <li key={fly.name}>
                <strong>{fly.name}</strong>
                {fly.size ? <span className="fish-size">{fly.size}</span> : null}
                <span className="fish-why">{fly.why}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="fish-block">
        <div className="fish-label">Lures to try</div>
        <ul className="fish-picks">
          {guide.lures.map((lure) => (
            <li key={lure.name}>
              <strong>{lure.name}</strong>
              {lure.size ? <span className="fish-size">{lure.size}</span> : null}
              <span className="fish-why">{lure.why}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="fish-block">
        <div className="fish-label">Regulations</div>
        <ul className="fish-regs">
          {guide.regulations.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>

      {guide.notes.map((note) => (
        <p key={note} className="fish-note">
          {note}
        </p>
      ))}

      <p className="fish-source">
        Hatch timing shifts with each year&apos;s weather and regulations are revised annually —
        check the current DWR guidebook before you keep a fish. Compiled from{" "}
        {guide.sources.map((source, i) => (
          <span key={source.url}>
            <a href={source.url} target="_blank" rel="noreferrer noopener">
              {source.name}
            </a>
            {i < guide.sources.length - 1 ? ", " : "."}
          </span>
        ))}
      </p>
    </div>
  );
}
