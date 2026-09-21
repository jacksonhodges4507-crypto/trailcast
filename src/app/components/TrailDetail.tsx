"use client";

import type { TrailReport } from "@/lib/types";
import { ACTIVITIES } from "@/lib/activities";
import { formatDrive } from "@/lib/format";
import {
  GRADE_CLASS,
  GRADE_COLOR,
  GRADE_TEXT,
  RATING_COLOR,
  ratingFor,
  ratingSteps,
} from "./grade";

export interface TrailDetailProps {
  report: TrailReport;
  onClose: () => void;
}

/**
 * The detail panel is where the product earns trust.
 *
 * Each factor carries two different quantities, and an earlier version showed
 * them as bare numbers side by side ("82 · 16%"), which read as one confusing
 * statistic. They are now two separate labelled bars: how good the factor is
 * today, and how much it counts toward this activity's score.
 */
export default function TrailDetail({ report, onClose }: TrailDetailProps) {
  const { trail, verdict, conditions, travel } = report;
  const activityLabel = ACTIVITIES[verdict.activity].label.toLowerCase();

  /*
   * `confidence` is the share of scoring weight that had data behind it. It
   * was rendered as "confidence 84%", which reads as statistical confidence
   * in the forecast -- something this app does not compute and could not
   * honestly claim. It is really a count of how many inputs arrived, so it
   * is now shown as one.
   */
  const withData = verdict.factors.filter((f) => f.score !== undefined);
  const missingInputs = verdict.factors
    .filter((f) => f.score === undefined)
    .map((f) => f.label);

  return (
    <aside className="detail">
      <div className="detail-head">
        <div>
          <h2>{trail.name}</h2>
          <div className="card-region">
            {trail.region}, {trail.state} · {trail.distanceMi} mi ·{" "}
            {trail.gainFt.toLocaleString()} ft gain
            {trail.rockType
              ? ` · ${trail.rockType}${trail.rockTypeSource === "inferred" ? "*" : ""}`
              : ""}
            {trail.routes ? ` · ${trail.routes} routes` : ""}
          </div>
        </div>
        <button className="detail-close" onClick={onClose} aria-label="Close details">
          ×
        </button>
      </div>

      <div className="detail-body">
        <p className="detail-blurb">{trail.blurb}</p>

        {travel ? (
          <div className="detail-drive">
            <strong>{formatDrive(travel.minutes)}</strong> drive each way · {travel.miles} mi
            <span>
              {travel.source === "estimate"
                ? "Estimated from straight-line distance — routing was unavailable."
                : "Free-flow road time: no traffic, closures or chain controls."}
            </span>
          </div>
        ) : null}

        <div
          className="card-headline"
          style={{ marginBottom: 14, color: GRADE_COLOR[verdict.grade] }}
        >
          {verdict.headline}
        </div>

        <div className="factors-key">
          Ordered by how much each matters for {activityLabel}
        </div>

        {verdict.factors.map((factor) => {
          const hasScore = factor.score !== undefined;
          const rating = hasScore ? ratingFor(factor.score as number) : null;
          const steps = hasScore ? ratingSteps(factor.score as number) : 0;
          const weightPct = Math.round(factor.weight * 100);

          return (
            <div className="factor" key={factor.id}>
              <div className="factor-head">
                <span className="factor-label">
                  {factor.label}
                  {factor.veto ? <span className="veto-flag">veto</span> : null}
                </span>
                <span className="factor-reading">{factor.display ?? "\u2014"}</span>
              </div>

              <div
                className="rating"
                title={`Rated ${rating ?? "no data"} for ${activityLabel}; counts for ${weightPct}% of the score`}
                aria-label={`${rating ?? "no data"}, ${steps} of 5`}
              >
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="rating-step"
                    style={{
                      background:
                        rating && i < steps
                          ? factor.veto
                            ? RATING_COLOR.critical
                            : RATING_COLOR[rating]
                          : "var(--border)",
                    }}
                  />
                ))}
                <em className="rating-word" style={{ color: rating ? RATING_COLOR[rating] : "var(--text-faint)" }}>
                  {rating ?? "no data"}
                </em>
              </div>

              <p className={factor.missingReason ? "factor-missing" : "factor-reason"}>
                {factor.reason}
              </p>
            </div>
          );
        })}

        {conditions.wildfires && conditions.wildfires.length > 0 ? (
          <div className="sources">
            <h3>Active fires within 100 mi</h3>
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
            Sources · {withData.length} of {verdict.factors.length} inputs available
          </h3>
          {missingInputs.length > 0 ? (
            <div className="source-item" style={{ color: "var(--grade-marginal)" }}>
              No data for {missingInputs.join(", ").toLowerCase()} — those factors were
              dropped rather than guessed.
            </div>
          ) : null}
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

        {trail.sourceName ? (
          <div className="sources">
            <h3>Area data</h3>
            <div className="source-item">
              <a href={trail.sourceUrl} target="_blank" rel="noreferrer noopener">
                {trail.sourceName}
              </a>
              {trail.rockTypeSource === "inferred"
                ? " · * rock type inferred from the surrounding region, not verified"
                : ""}
            </div>
          </div>
        ) : null}

        {travel ? (
          <div className="sources">
            <h3>Routing</h3>
            <div className="source-item">
              {travel.source === "osrm" ? (
                <a href="https://project-osrm.org/" target="_blank" rel="noreferrer noopener">
                  OSRM
                </a>
              ) : (
                "Straight-line estimate"
              )}
              {" · from your location, rounded to ~1 km and not stored"}
            </div>
          </div>
        ) : null}

        <div className="sources">
          <h3>Terrain inputs</h3>
          <div className="source-item">
            surface={trail.surface} · aspect={trail.aspect} ·{" "}
            exposed={String(trail.exposed)}
            {trail.rockType
              ? ` · rock=${trail.rockType} (${trail.rockTypeSource ?? "curated"})`
              : ""}
            {trail.waterCrossings > 0 ? ` · crossings=${trail.waterCrossings}` : ""}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <span className={`score-grade ${GRADE_CLASS[verdict.grade]}`}>
            {GRADE_TEXT[verdict.grade]}
            {verdict.score !== undefined ? ` · ${verdict.score}/100 overall` : ""}
          </span>
        </div>
      </div>
    </aside>
  );
}
