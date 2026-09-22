"use client";

import { useEffect, useMemo, useState } from "react";

/** One route: [name, grade, type code, length in metres (0 = unknown), wall index, OpenBeta id]. */
type RouteRow = [string, string, string, number, number, string?];

interface ClimbData {
  walls: { n: string; u?: string; lat: number; lng: number; c: number }[];
  routes: RouteRow[];
  /** Routes OpenBeta lists for the area, including any trimmed from this file. */
  total: number;
  source: string;
}

const TYPE_LABEL: Record<string, string> = {
  S: "Sport",
  T: "Trad",
  B: "Boulder",
  TR: "Top rope",
  A: "Aid",
  I: "Ice",
  AL: "Alpine",
};

const FILTERS = ["all", "S", "T", "B"] as const;
type Filter = (typeof FILTERS)[number];

const PAGE = 25;

/**
 * Real routes for a climbing area, from OpenBeta.
 *
 * Fetched live (and cached for a day at the edge) when an area is opened,
 * so thousands of route names never ride along in the page bundle.
 */
/** Search links, so anyone can see what a wall or route looks like. */
function photosUrl(...parts: string[]): string {
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${parts.filter(Boolean).join(" ")} climbing Utah`)}`;
}

export default function ClimbRoutes({ trailId, areaName }: { trailId: string; areaName?: string }) {
  const [data, setData] = useState<ClimbData | null>(null);
  const [missing, setMissing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [wall, setWall] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setMissing(false);
    setWall(null);
    setFilter("all");
    setShown(PAGE);
    // One retry: a first request for a big area can land on a cold cache.
    const load = () =>
      fetch(`/api/climbs?id=${encodeURIComponent(trailId)}`).then((r) =>
        r.ok ? (r.json() as Promise<ClimbData>) : Promise.reject(new Error("none")),
      );
    load()
      .catch(() => new Promise((resolve) => setTimeout(resolve, 1500)).then(load))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [trailId]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of data?.routes ?? []) out[r[2]] = (out[r[2]] ?? 0) + 1;
    return out;
  }, [data]);

  const rows = useMemo(
    () =>
      (data?.routes ?? []).filter(
        (r) => (filter === "all" || r[2] === filter) && (wall === null || r[4] === wall),
      ),
    [data, filter, wall],
  );

  if (missing) {
    return (
      <div className="climbs climbs-loading">
        Route list is unavailable right now — OpenBeta did not answer. Scores above are unaffected.
      </div>
    );
  }
  if (!data) return <div className="climbs climbs-loading">Loading routes…</div>;

  const topWalls = data.walls
    .map((w, i) => ({ ...w, i }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 12);

  return (
    <div className="climbs">
      <h3>Routes here</h3>
      <p className="climbs-sub">
        {data.total.toLocaleString()} routes on {data.walls.length} wall
        {data.walls.length === 1 ? "" : "s"}
        {data.routes.length < data.total ? ` · ${data.routes.length} listed` : ""}
      </p>

      {topWalls.length > 1 ? (
        <div className="climbs-walls">
          <button type="button" aria-pressed={wall === null} onClick={() => { setWall(null); setShown(PAGE); }}>
            All walls
          </button>
          {topWalls.map((w) => (
            <button
              key={w.i}
              type="button"
              aria-pressed={wall === w.i}
              onClick={() => { setWall(wall === w.i ? null : w.i); setShown(PAGE); }}
            >
              {w.n} <span>{w.c}</span>
            </button>
          ))}
        </div>
      ) : null}

      {wall !== null && data.walls[wall] ? (
        <div className="climbs-wall-links">
          <strong>{data.walls[wall]!.n}</strong>
          {data.walls[wall]!.u ? (
            <a href={`https://openbeta.io/area/${data.walls[wall]!.u}`} target="_blank" rel="noreferrer noopener">
              Wall page
            </a>
          ) : null}
          <a href={photosUrl(data.walls[wall]!.n, areaName ?? "")} target="_blank" rel="noreferrer noopener">
            Photos
          </a>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${data.walls[wall]!.lat},${data.walls[wall]!.lng}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Directions
          </a>
        </div>
      ) : null}

      <div className="climbs-filters" role="group" aria-label="Route type">
        {FILTERS.filter((f) => f === "all" || (counts[f] ?? 0) > 0).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => { setFilter(f); setShown(PAGE); }}>
            {f === "all" ? "All" : TYPE_LABEL[f]}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="climbs-sub">No routes of that type here.</p>
      ) : (
        <ul className="climbs-list">
          {rows.slice(0, shown).map((r, index) => (
            <li key={`${r[0]}-${index}`}>
              <a
                className="climb-name"
                href={r[5] ? `https://openbeta.io/climb/${r[5]}` : photosUrl(r[0], data.walls[r[4]]?.n ?? "", areaName ?? "")}
                target="_blank"
                rel="noreferrer noopener"
                title={r[5] ? "Open this route on OpenBeta (description, topo, photos)" : "Search for this route"}
              >
                {r[0]}
              </a>
              <span className="climb-grade">{r[1] || "?"}</span>
              <span className="climb-meta">
                {TYPE_LABEL[r[2]] ?? ""}
                {r[3] > 0 ? ` · ${Math.round(r[3] * 3.281)} ft` : ""}
                {wall === null && data.walls[r[4]] ? ` · ${data.walls[r[4]]!.n}` : ""}
                {" · "}
                <a
                  href={photosUrl(r[0], data.walls[r[4]]?.n ?? "", areaName ?? "")}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  photos
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}

      {rows.length > shown ? (
        <button type="button" className="climbs-more" onClick={() => setShown((n) => n + 50)}>
          Show more ({rows.length - shown} left)
        </button>
      ) : null}

      <p className="climbs-source">
        Route data from{" "}
        <a href="https://openbeta.io/" target="_blank" rel="noreferrer noopener">
          OpenBeta
        </a>
        , {data.source}. Check a current guidebook before committing to a line.
      </p>
    </div>
  );
}
