"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MapView from "./MapView";
import TrailDetail from "./TrailDetail";
import FishDex from "./FishDex";
import type { SpeciesId } from "@/lib/fishing/species";
import AskBar from "./AskBar";
import ThemeToggle from "./ThemeToggle";
import { formatDrive, routeFigures } from "@/lib/format";
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

  // The Fish Dex shares the right-hand column with a water's detail.
  const [dexOpen, setDexOpen] = useState(false);
  const [dexFocus, setDexFocus] = useState<SpeciesId | null>(null);

  const openSpecies = useCallback((id: SpeciesId | null) => {
    setDexFocus(id);
    setDexOpen(true);
  }, []);

  const selectFromDex = useCallback((trailId: string) => {
    setDexOpen(false);
    setSelectedId(trailId);
  }, []);

  /*
   * The viewer's location, held in memory only.
   *
   * Requested on an explicit click, never on page load; rounded to about a
   * kilometre before it goes anywhere; and deliberately not written to
   * storage, so closing the tab forgets it. Asking again next visit costs one
   * click, which is the right price for not keeping someone's whereabouts.
   */
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  /*
   * Sharing a location switches the list to nearest-first, because that is
   * the question someone who just tapped "use my location" is asking. The
   * toggle brings best-conditions order back; the map is unaffected.
   */
  const [sortBy, setSortBy] = useState<"best" | "closest">("best");
  useEffect(() => {
    setSortBy(coords ? "closest" : "best");
  }, [coords]);

  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocError("This browser cannot share a location.");
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          lat: Math.round(position.coords.latitude * 100) / 100,
          lon: Math.round(position.coords.longitude * 100) / 100,
        });
        setLocating(false);
      },
      (error) => {
        setLocating(false);
        setLocError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was declined. Everything else still works."
            : "Could not get a location just now.",
        );
      },
      // Coarse is plenty for drive times, and faster and cheaper on battery.
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 },
    );
  }, []);

  const days = useMemo(() => forecastWindow(today), [today]);

  // Refetch whenever the view changes, skipping the initial server-rendered
  // combination, which we already have.
  useEffect(() => {
    if (activity === initial.activity && date === initial.date && data === initial && !coords) {
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const origin = coords ? `&lat=${coords.lat}&lon=${coords.lon}` : "";
    fetch(`/api/conditions?date=${date}&activity=${activity}${origin}`, {
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
  }, [activity, date, coords]);

  const handleAnswer = useCallback((answer: AskAnswer) => {
    setActivity(answer.query.activity);
    setDate(answer.query.date);
    const top = answer.results[0];
    if (top) setSelectedId(top.trail.id);
  }, []);

  const listed = useMemo(() => {
    if (sortBy !== "closest") return data.reports;
    return data.reports
      .slice()
      .sort(
        (a, b) =>
          (a.travel?.minutes ?? Number.POSITIVE_INFINITY) -
          (b.travel?.minutes ?? Number.POSITIVE_INFINITY),
      );
  }, [data.reports, sortBy]);

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
          {data.available > data.scored ? (
            <span className="chip" title={`${data.available} areas match this activity; the nearest or largest ${data.scored} are scored per request to stay a polite client of the upstream APIs.`}>
              scoring {data.scored} of {data.available}
            </span>
          ) : null}
          <SourceChips status={data.sourceStatus} degraded={data.degraded} />
          <ThemeToggle />
        </div>
      </header>

      {error ? <div className="banner">{error}</div> : null}

      <div className={`workspace${selected || dexOpen ? " has-detail" : ""}`}>
        <div className="rail">
          <div className="controls">
            <div className="segmented" role="group" aria-label="Activity">
              {ACTIVITY_IDS.map((id) => (
                <button
                  key={id}
                  aria-pressed={activity === id}
                  onClick={() => {
                    setActivity(id);
                    if (id !== "fish") setDexOpen(false);
                  }}
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

          {activity === "fish" ? (
            <div className="dex-launch">
              <button type="button" onClick={() => openSpecies(null)}>
                <span aria-hidden>{"📖"}</span> Fish Dex
              </button>
              <span>Species, flies and regulations for every water</span>
            </div>
          ) : null}

          <div className="locate">
            {coords ? (
              <>
                <span>
                  <span aria-hidden>📍</span> Drive times from your location
                </span>
                <button type="button" onClick={() => setCoords(null)}>
                  Clear
                </button>
                <div className="sort-toggle" role="group" aria-label="Sort">
                  <button
                    type="button"
                    aria-pressed={sortBy === "closest"}
                    onClick={() => setSortBy("closest")}
                  >
                    Closest
                  </button>
                  <button
                    type="button"
                    aria-pressed={sortBy === "best"}
                    onClick={() => setSortBy("best")}
                  >
                    Best conditions
                  </button>
                </div>
              </>
            ) : (
              <button type="button" onClick={requestLocation} disabled={locating}>
                <span aria-hidden>📍</span>{" "}
                {locating ? "Locating\u2026" : "Use my location for drive times"}
              </button>
            )}
            {locError ? <span className="locate-error">{locError}</span> : null}
          </div>

          <AskBar onAnswer={handleAnswer} coords={coords} />

          {loading ? (
            <div className="loading">Scoring {ACTIVITIES[activity].label.toLowerCase()} conditions…</div>
          ) : data.reports.length === 0 ? (
            <div className="empty">
              No scored trails for this view. Sources may be unavailable — try again
              in a moment.
            </div>
          ) : (
            <div className="list">
              {listed.map((report) => (
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
                    {report.travel ? (
                      <span className="drive" title={report.travel.source === "estimate" ? "Estimated from straight-line distance" : "Free-flow drive time, no traffic"}>
                        <span aria-hidden>🚗</span> {formatDrive(report.travel.minutes)}{" "}
                        · {report.travel.miles} mi
                        {report.travel.source === "estimate" ? "*" : ""}
                      </span>
                    ) : null}
                    {routeFigures(report.trail, activity).map((figure) => (
                      <span key={figure}>{figure}</span>
                    ))}
                    {/*
                      Confidence used to show here as a percentage on every
                      card. It is a count of inputs received, not a
                      probability, and it reads 100% almost always -- so it
                      was noise on every card and silent in the one case that
                      mattered. It now appears only when something is missing.
                    */}
                    {report.verdict.factors.some((f) => f.score === undefined) ? (
                      <span style={{ color: "var(--grade-marginal)" }}>
                        {report.verdict.factors.filter((f) => f.score === undefined).length}{" "}
                        input
                        {report.verdict.factors.filter((f) => f.score === undefined).length === 1
                          ? ""
                          : "s"}{" "}
                        missing
                      </span>
                    ) : null}
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
              <span className="dot" style={{ background: "var(--grade-prime)" }} /> prime
            </span>
            <span>
              <span className="dot" style={{ background: "var(--grade-good)" }} /> good
            </span>
            <span>
              <span className="dot" style={{ background: "var(--grade-marginal)" }} /> marginal
            </span>
            <span>
              <span className="dot" style={{ background: "var(--grade-poor)" }} /> poor
            </span>
            <span>
              <span className="dot" style={{ background: "var(--grade-unsafe)" }} /> no-go
            </span>
            <span style={{ opacity: 0.7 }}>
              {relativeLabel(date, today)} · {ACTIVITIES[activity].label.toLowerCase()}
            </span>
          </div>

        </div>

        {/*
          The detail panel is a column of its own rather than a box floating
          over the map. Overlaying it hid the part of the map nearest the pin
          you had just clicked; as a column, the map keeps every pixel it is
          given and simply narrows, then widens again on close.
        */}
        {dexOpen ? (
          <FishDex
            focus={dexFocus}
            onFocus={setDexFocus}
            onSelectWater={selectFromDex}
            onClose={() => setDexOpen(false)}
          />
        ) : selected ? (
          <TrailDetail
            report={selected}
            onClose={() => setSelectedId(null)}
            onOpenSpecies={openSpecies}
          />
        ) : null}
      </div>
    </div>
  );
}
