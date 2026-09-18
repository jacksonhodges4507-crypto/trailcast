"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MapView from "./MapView";
import TrailDetail from "./TrailDetail";
import AskBar from "./AskBar";
import { GRADE_CLASS, GRADE_TEXT } from "./grade";
import { ACTIVITIES, ACTIVITY_IDS } from "@/lib/activities";
import { forecastWindow, relativeLabel, weekdayName } from "@/lib/dates";
import type { ActivityId, AskAnswer, ConditionsResponse, SourceStatus } from "@/lib/types";

export interface DashboardProps {
  initial: ConditionsResponse;
  today: string;
}

function SourceChips({ status, degraded }: { status: SourceStatus[]; degraded: boolean }) {
  if (status.length === 0) return null;

  return (
    <div className="statusbar">
      {status.map((source) => {
        const tone = !source.ok ? "dot-down" : source.cached ? "dot-cached" : "dot-ok";
        const detail = !source.ok
          ? source.error ?? "unavailable"
          : source.cached
            ? `cached ${Math.round(source.cacheAgeSeconds ?? 0)}s`
            : `${source.latencyMs}ms`;

        return (
          <span className="chip" key={source.sourceId} title={detail}>
            <span className={`dot ${tone}`} />
            {source.sourceName}
            <span style={{ opacity: 0.6 }}>{detail}</span>
          </span>
        );
      })}
      {degraded ? <span style={{ color: "var(--grade-poor)" }}>partial data</span> : null}
    </div>
  );
}

export default function Dashboard({ initial, today }: DashboardProps) {
  const [activity, setActivity] = useState<ActivityId>(initial.activity);
  const [date, setDate] = useState<string>(initial.date);
  const [data, setData] = useState<ConditionsResponse>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const days = useMemo(() => forecastWindow(today), [today]);

  // Refetch whenever the view changes, skipping the initial server-rendered
  // combination, which we already have.
  useEffect(() => {
    if (activity === initial.activity && date === initial.date && data === initial) {
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/conditions?date=${date}&activity=${activity}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        return (await response.json()) as ConditionsResponse;
      })
      .then((next) => {
        setData(next);
        setSelectedId((current) =>
          current && next.reports.some((r) => r.trail.id === current) ? current : null,
        );
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Could not load conditions");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
    // `data`/`initial` are intentionally excluded: this effect reacts to the
    // user's chosen view, not to the payload it produces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, date]);

  const handleAnswer = useCallback((answer: AskAnswer) => {
    setActivity(answer.query.activity);
    setDate(answer.query.date);
    const top = answer.results[0];
    if (top) setSelectedId(top.trail.id);
  }, []);

  const selected = useMemo(
    () => data.reports.find((report) => report.trail.id === selectedId) ?? null,
    [data.reports, selectedId],
  );

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <h1>TrailCast</h1>
          <span className="tagline">
            live conditions, scored per trail, with receipts
          </span>
        </div>
        <div className="masthead-right">
          <SourceChips status={data.sourceStatus} degraded={data.degraded} />
        </div>
      </header>

      {error ? <div className="banner">{error}</div> : null}

      <div className="workspace">
        <div className="rail">
          <div className="controls">
            <div className="segmented" role="group" aria-label="Activity">
              {ACTIVITY_IDS.map((id) => (
                <button
                  key={id}
                  aria-pressed={activity === id}
                  onClick={() => setActivity(id)}
                >
                  <span aria-hidden>{ACTIVITIES[id].glyph}</span>
                  {ACTIVITIES[id].label}
                </button>
              ))}
            </div>

            <div className="dayscroll" role="group" aria-label="Day">
              {days.map((day) => (
                <button key={day} aria-pressed={date === day} onClick={() => setDate(day)}>
                  <span className="dow">
                    {day === today ? "Today" : weekdayName(day).slice(0, 3)}
                  </span>
                  <span className="dom">{day.slice(5)}</span>
                </button>
              ))}
            </div>
          </div>

          <AskBar onAnswer={handleAnswer} />

          {loading ? (
            <div className="loading">Scoring {ACTIVITIES[activity].label.toLowerCase()} conditions…</div>
          ) : data.reports.length === 0 ? (
            <div className="empty">
              No scored trails for this view. Sources may be unavailable — try again
              in a moment.
            </div>
          ) : (
            <div className="list">
              {data.reports.map((report) => (
                <button
                  key={report.trail.id}
                  className="card"
                  aria-selected={selectedId === report.trail.id}
                  onClick={() =>
                    setSelectedId((current) =>
                      current === report.trail.id ? null : report.trail.id,
                    )
                  }
                >
                  <div className="card-top">
                    <div>
                      <div className="card-name">{report.trail.name}</div>
                      <div className="card-region">
                        {report.trail.region}, {report.trail.state}
                      </div>
                    </div>
                    <div className={`score ${GRADE_CLASS[report.verdict.grade]}`}>
                      <span className="score-value">
                        {report.verdict.score ?? "—"}
                      </span>
                      <span className="score-grade">
                        {GRADE_TEXT[report.verdict.grade]}
                      </span>
                    </div>
                  </div>

                  <div className="card-headline">{report.verdict.headline}</div>

                  <div className="card-stats">
                    <span>{report.trail.distanceMi} mi</span>
                    <span>{report.trail.gainFt.toLocaleString()} ft</span>
                    <span>{Math.round(report.verdict.confidence * 100)}% conf</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="canvas">
          <MapView
            reports={data.reports}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
          />

          <div className="legend">
            <span>
              <span className="dot" style={{ background: "#34d399" }} /> prime
            </span>
            <span>
              <span className="dot" style={{ background: "#a3e635" }} /> good
            </span>
            <span>
              <span className="dot" style={{ background: "#fbbf24" }} /> marginal
            </span>
            <span>
              <span className="dot" style={{ background: "#fb923c" }} /> poor
            </span>
            <span>
              <span className="dot" style={{ background: "#f43f5e" }} /> no-go
            </span>
            <span style={{ opacity: 0.7 }}>
              {relativeLabel(date, today)} · {ACTIVITIES[activity].label.toLowerCase()}
            </span>
          </div>

          {selected ? (
            <TrailDetail report={selected} onClose={() => setSelectedId(null)} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
