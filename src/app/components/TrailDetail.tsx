"use client";

import type { TrailReport } from "@/lib/types";
import { GRADE_CLASS, GRADE_COLOR, GRADE_TEXT, scoreColor } from "./grade";

export interface TrailDetailProps {
  report: TrailReport;
  onClose: () => void;
}

/**
 * The detail panel is where the product earns trust: every factor shows its
 * score, the weight it carried for this activity, the sentence explaining it,
 * and a link to the upstream request it came from.
 */
export default function TrailDetail({ report, onClose }: TrailDetailProps) {
  const { trail, verdict, conditions } = report;

  return (
    <aside className="detail">
      <div className="detail-head">
        <div>
          <h2>{trail.name}</h2>
          <div className="card-region">
            {trail.region}, {trail.state} · {trail.distanceMi} mi ·{" "}
            {trail.gainFt.toLocaleString()} ft gain
          </div>
        </div>
        <button className="detail-close" onClick={onClose} aria-label="Close details">
          ×
        </button>
      </div>

      <div className="detail-body">
        <p className="detail-blurb">{trail.blurb}</p>

        <div
          className="card-headline"
          style={{ marginBottom: 16, color: GRADE_COLOR[verdict.grade] }}
        >
          {verdict.headline}
        </div>

        {verdict.factors.map((factor) => {
          const pct = factor.score ?? 0;
          return (
            <div className="factor" key={factor.id}>
              <div className="factor-head">
                <span className="factor-label">
                  {factor.label}
                  {factor.veto ? <span className="veto-flag">veto</span> : null}
                </span>
                <span className="factor-score">
                  {factor.score !== undefined ? `${Math.round(factor.score)}` : "—"}
                  <span className="factor-weight">
                    {" "}
                    · {Math.round(factor.weight * 100)}%
                  </span>
                </span>
              </div>

              <div className="meter">
                <span
                  style={{
                    width: `${factor.score !== undefined ? pct : 0}%`,
                    background: factor.veto
                      ? GRADE_COLOR.unsafe
                      : scoreColor(factor.score, verdict.grade),
                  }}
                />
              </div>

              <p className={factor.missingReason ? "factor-missing" : "factor-reason"}>
                {factor.reason}
              </p>
            </div>
          );
        })}

        {conditions.wildfires && conditions.wildfires.length > 0 ? (
          <div className="sources">
            <h3>Active fires within 35 mi</h3>
            {conditions.wildfires.slice(0, 4).map((fire) => (
              <div className="source-item" key={`${fire.name}-${fire.distanceMi}`}>
                {fire.name} — {fire.distanceMi} mi
                {fire.acres !== undefined ? ` · ${fire.acres.toLocaleString()} ac` : ""}
              </div>
            ))}
          </div>
        ) : null}

        <div className="sources">
          <h3>
            Sources · confidence {Math.round(verdict.confidence * 100)}%
          </h3>
          {verdict.sources.length === 0 ? (
            <div className="source-item">No sources responded for this trail.</div>
          ) : (
            verdict.sources.map((ref) => (
              <div className="source-item" key={`${ref.sourceId}-${ref.field ?? ""}`}>
                <a href={ref.url} target="_blank" rel="noreferrer noopener">
                  {ref.sourceName}
                </a>
                {ref.field ? ` · ${ref.field}` : ""} ·{" "}
                {new Date(ref.fetchedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            ))
          )}
        </div>

        <div className="sources">
          <h3>Terrain inputs</h3>
          <div className="source-item">
            surface={trail.surface} · aspect={trail.aspect} ·{" "}
            exposed={String(trail.exposed)} · crossings={trail.waterCrossings}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <span className={`score-grade ${GRADE_CLASS[verdict.grade]}`}>
            {GRADE_TEXT[verdict.grade]}
            {verdict.score !== undefined ? ` · ${verdict.score}/100` : ""}
          </span>
        </div>
      </div>
    </aside>
  );
}
