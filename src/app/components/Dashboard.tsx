"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MapView from "./MapView";
import TrailDetail from "./TrailDetail";
import FishDex from "./FishDex";
import type { SpeciesId } from "@/lib/fishing/species";
import AskBar from "./AskBar";
import ThemeToggle from "./ThemeToggle";
import { Logo, Wordmark } from "./Brand";
import { formatDrive, quickStats, routeFigures } from "@/lib/format";
import { GRADE_CLASS, GRADE_COLOR, GRADE_TEXT } from "./grade";
import { ACTIVITIES, ACTIVITY_IDS } from "@/lib/activities";
import { forecastWindow, relativeLabel, weekdayName } from "@/lib/dates";
import type { ActivityId, AskAnswer, ConditionsResponse, SourceStatus } from "@/lib/types";

export interface DashboardProps {
  initial: ConditionsResponse;
  today: string;
}

type MobileView = "map" | "scout" | "saved" | "you";

const SAVED_KEY = "trailcast.saved.v1";

function readSaved(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SAVED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeSaved(ids: string[]): void {
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(ids));
  } catch {
    // Storage blocked: saving still works for this visit.
  }
}

function isPhone(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(max-width: 900px)").matches === true;
}

function TabIcon({ name }: { name: MobileView }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "map") return <svg {...common}><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" /><path d="M9 4v14M15 6v14" /></svg>;
  if (name === "scout") return <svg {...common}><path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7Z" /></svg>;
  if (name === "saved") return <svg {...common}><path d="M6 3h12v18l-6-4-6 4V3Z" /></svg>;
  return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>;
}

function SourceChips({ status, degraded }: { status: SourceStatus[]; degraded: boolean }) {
  if (status.length === 0) return null;

  const up = status.filter((s) => s.ok).length;
  return (
    <>
    <span
      className={`chip status-compact`}
      title={status.map((s) => `${s.sourceName}: ${s.ok ? "ok" : s.error ?? "down"}`).join("\n")}
    >
      <span className={`dot ${up === status.length ? "dot-ok" : "dot-down"}`} />
      <em style={{ fontStyle: "normal" }}>
        {up}/{status.length} sources live
      </em>
    </span>
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
    </>
  );
}

export default function Dashboard({ initial, today }: DashboardProps) {
  const [activity, setActivity] = useState<ActivityId>(initial.activity);
  const [date, setDate] = useState<string>(initial.date);
  const [data, setData] = useState<ConditionsResponse>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Free-text filter over names and regions, shared by the list and the map.
  const [search, setSearch] = useState("");

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

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return data.reports;
    return data.reports.filter((r) =>
      `${r.trail.name} ${r.trail.region}`.toLowerCase().includes(needle),
    );
  }, [data.reports, search]);

  const listed = useMemo(() => {
    if (sortBy !== "closest") return visible;
    return visible
      .slice()
      .sort(
        (a, b) =>
          (a.travel?.minutes ?? Number.POSITIVE_INFINITY) -
          (b.travel?.minutes ?? Number.POSITIVE_INFINITY),
      );
  }, [visible, sortBy]);

  /*
   * Phones get two tabs instead of a list stacked on a squeezed map: "Ask"
   * (the question box, answer and list) and "Map" (the map, full height).
   * On wider screens both are visible and the tabs are hidden by CSS.
   */
  const [mobileView, setMobileView] = useState<MobileView>("map");
  const showMap = useCallback(() => setMobileView("map"), []);

  /*
   * On the phone map, tapping a pin shows a short "peek" card first; the full
   * conditions open as a sheet only when asked for, so the map stays usable.
   */
  const [sheetOpen, setSheetOpen] = useState(false);

  // Places the viewer has starred. Kept in this browser only.
  const [savedIds, setSavedIds] = useState<string[]>([]);
  useEffect(() => {
    setSavedIds(readSaved());
  }, []);
  const toggleSave = useCallback((id: string) => {
    setSavedIds((current) => {
      const next = current.includes(id) ? current.filter((x) => x !== id) : [id, ...current];
      writeSaved(next);
      return next;
    });
  }, []);


  // "Ask Scout about this place" hands a question to the Scout panel.
  const [scoutPrefill, setScoutPrefill] = useState<{ text: string; nonce: number } | null>(null);

  /** A card in a list: open the full conditions straight away. */
  const openFromList = useCallback((id: string) => {
    setSelectedId(id);
    setSheetOpen(true);
  }, []);

  /** A pin: on a phone show the peek card; on a desktop toggle the column. */
  const selectFromMap = useCallback((id: string) => {
    if (isPhone()) {
      setSelectedId(id);
      setSheetOpen(false);
    } else {
      setSelectedId((current) => (current === id ? null : id));
    }
  }, []);

  /** A Scout pick: on a phone jump to the map with the peek card up. */
  const pickFromScout = useCallback((id: string) => {
    setSelectedId(id);
    if (isPhone()) {
      setMobileView("map");
      setSheetOpen(false);
    } else {
      setSheetOpen(true);
    }
  }, []);

  const closeDetail = useCallback(() => {
    // On the phone map, closing the sheet returns to the peek card.
    if (isPhone() && mobileView === "map") setSheetOpen(false);
    else {
      setSheetOpen(false);
      setSelectedId(null);
    }
  }, [mobileView]);

  const askScoutAbout = useCallback(
    (report: { trail: { name: string }; verdict: { activity: ActivityId; date: string } }) => {
      const day = relativeLabel(report.verdict.date, today);
      const verb = ACTIVITIES[report.verdict.activity].label.toLowerCase();
      setScoutPrefill({ text: `How is ${report.trail.name} for ${verb} ${day}?`, nonce: Date.now() });
      setMobileView("scout");
      setSheetOpen(false);
    },
    [today],
  );

  const selected = useMemo(
    () => data.reports.find((report) => report.trail.id === selectedId) ?? null,
    [data.reports, selectedId],
  );

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <Logo size={34} />
          <div>
            <h1>
              <Wordmark />
            </h1>
            <span className="tagline">Know where to go, and when to go.</span>
          </div>
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

      <div
        className={`workspace view-${mobileView}${selected || dexOpen ? " has-detail" : ""}${sheetOpen || dexOpen ? " sheet-open" : ""}`}
      >
        <div className="rail">
          <div className="controls sec-controls">
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
            <div className="dex-launch sec-list">
              <button type="button" onClick={() => openSpecies(null)}>
                <span aria-hidden>{"📖"}</span> Fish Dex
              </button>
              <span>Species, flies and regulations for every water</span>
            </div>
          ) : null}

          <div className="locate sec-you">
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

          <div className="sec-scout">
            <AskBar
              onAnswer={handleAnswer}
              coords={coords}
              onShowMap={showMap}
              onPick={pickFromScout}
              prefill={scoutPrefill}
            />
          </div>

          <div className="you-extra sec-you mobile-only">
            <div className="you-row">
              <span>Appearance</span>
              <ThemeToggle />
            </div>
            <div className="you-row you-sources">
              <span>Live sources</span>
              <SourceChips status={data.sourceStatus} degraded={data.degraded} />
            </div>
            <p className="you-note">
              TrailCast keeps nothing about you on a server. Saved places and search
              history stay in this browser; your location is used once, rounded to
              about a kilometre, and never stored.
            </p>
          </div>

          <div className={`saved-section sec-saved${savedIds.length === 0 ? " desktop-hide" : ""}`}>
            <h3>
              <span aria-hidden>★</span> Saved
            </h3>
            {savedIds.length === 0 ? (
              <p className="saved-empty">
                Tap ☆ on any place to keep it here for quick checks.
              </p>
            ) : (
              <div className="saved-list">
                {savedIds.map((id) => {
                  const report = data.reports.find((r) => r.trail.id === id);
                  if (!report) return null;
                  return (
                    <button key={id} type="button" className="saved-item" onClick={() => openFromList(id)}>
                      <span className="pick-score" style={{ background: GRADE_COLOR[report.verdict.grade] }}>
                        {report.verdict.score ?? "–"}
                      </span>
                      <span className="pick-body">
                        <strong>{report.trail.name}</strong>
                        <span>{report.verdict.headline}</span>
                      </span>
                    </button>
                  );
                })}
                {savedIds.every((id) => !data.reports.some((r) => r.trail.id === id)) ? (
                  <p className="saved-empty">
                    Your saved places are for another activity — switch activity to see them.
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <div className="search-box sec-list">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search trails, crags, lakes"
              aria-label="Search places"
            />
          </div>

          {loading ? (
            <div className="loading">Scoring {ACTIVITIES[activity].label.toLowerCase()} conditions…</div>
          ) : data.reports.length === 0 ? (
            <div className="empty">
              No scored trails for this view. Sources may be unavailable — try again
              in a moment.
            </div>
          ) : (
            <div className="list sec-list">
              {listed.map((report) => (
                <button
                  key={report.trail.id}
                  className="card"
                  aria-selected={selectedId === report.trail.id}
                  onClick={() => openFromList(report.trail.id)}
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
              <button type="button" className="mobile-only map-link" onClick={showMap}>
                <span aria-hidden>🗺️</span> See these {listed.length} on the map
              </button>
            </div>
          )}
        </div>

        <div className="canvas">
          <MapView
            reports={visible}
            selectedId={selectedId}
            onSelect={selectFromMap}
            activity={activity}
          />

          <div className="map-top mobile-only">
            <div className="map-search">
              <span aria-hidden>⌕</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search trails, crags, lakes"
                aria-label="Search places"
              />
              <select
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-label="Day"
              >
                {days.map((day) => (
                  <option key={day} value={day}>
                    {day === today ? "Today" : weekdayName(day).slice(0, 3)}
                  </option>
                ))}
              </select>
            </div>
            <div className="map-chips" role="group" aria-label="Activity">
              {ACTIVITY_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={activity === id}
                  onClick={() => {
                    setActivity(id);
                    if (id !== "fish") setDexOpen(false);
                  }}
                >
                  {ACTIVITIES[id].label}
                </button>
              ))}
            </div>
          </div>

          {selected && !sheetOpen ? (
            <div className="peek mobile-only">
              <div className="peek-top">
                <div>
                  <div className="detail-kicker">{ACTIVITIES[selected.verdict.activity].label}</div>
                  <div className="peek-name">{selected.trail.name}</div>
                </div>
                <div className="peek-score" style={{ background: GRADE_COLOR[selected.verdict.grade] }}>
                  <strong>{selected.verdict.score ?? "–"}</strong>
                  <span>{GRADE_TEXT[selected.verdict.grade]}</span>
                </div>
              </div>
              <div className="peek-stats">
                {quickStats(selected).map((stat) => (
                  <div key={stat.label}>
                    <strong>{stat.value}</strong>
                    <span>{stat.label}</span>
                  </div>
                ))}
              </div>
              <p className="peek-line">{selected.verdict.headline}</p>
              <div className="peek-actions">
                <button type="button" className="cta" onClick={() => setSheetOpen(true)}>
                  See full conditions
                </button>
                <button
                  type="button"
                  className="round-btn"
                  aria-label={savedIds.includes(selected.trail.id) ? "Remove from saved" : "Save this place"}
                  aria-pressed={savedIds.includes(selected.trail.id)}
                  onClick={() => toggleSave(selected.trail.id)}
                >
                  {savedIds.includes(selected.trail.id) ? "★" : "☆"}
                </button>
                <button type="button" className="round-btn" aria-label="Close" onClick={() => setSelectedId(null)}>
                  ×
                </button>
              </div>
            </div>
          ) : null}

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
            onClose={closeDetail}
            onOpenSpecies={openSpecies}
            saved={savedIds.includes(selected.trail.id)}
            onToggleSave={() => toggleSave(selected.trail.id)}
            onAskScout={() => askScoutAbout(selected)}
          />
        ) : null}
      </div>

      <nav className="mobile-tabs" aria-label="View">
        {(
          [
            ["map", "Map"],
            ["scout", "Scout"],
            ["saved", "Saved"],
            ["you", "You"],
          ] as const
        ).map(([view, label]) => (
          <button
            key={view}
            type="button"
            aria-pressed={mobileView === view}
            onClick={() => {
              setMobileView(view);
              setSheetOpen(false);
              setDexOpen(false);
            }}
          >
            <TabIcon name={view} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
