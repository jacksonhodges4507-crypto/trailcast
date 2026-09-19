"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TrailReport } from "@/lib/types";
import { GRADE_COLOR } from "./grade";

/**
 * MapLibre is loaded from a CDN at runtime rather than bundled: it is a
 * ~900 kB dependency used by one component, and the list view -- the part
 * that must work -- should not wait for it.
 *
 * Everything else here exists because a third-party tile service will fail
 * eventually. It already has: the style JSON parsed, the canvas sized
 * correctly, and the map then sat at a blank white rectangle without ever
 * firing `load` or `error`. Silence is the worst failure mode, so the map now
 * gives itself a deadline and says so when it misses it.
 */

const MAPLIBRE_JS = "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js";
const MAPLIBRE_CSS = "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css";
/**
 * A raster basemap defined inline, rather than a hosted vector style.
 *
 * The previous choice was a vector style whose JSON, sprites and TileJSON all
 * fetched with 200s -- and then the map sat blank forever, firing neither
 * `load` nor `error`. A vector basemap has a lot of surface to fail on: a
 * 111-layer style document, a sprite sheet, glyph ranges, and tile parsing in
 * a worker, any of which can stall silently.
 *
 * This app draws pins on a backdrop. It does not need vector styling, so it
 * does not need that surface. Raster tiles are one request each, rendered
 * directly, with the style defined here so there is no style document to
 * fetch at all.
 */
const BASEMAP_STYLE = {
  version: 8,
  sources: {
    basemap: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      maxzoom: 20,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [{ id: "basemap", type: "raster", source: "basemap" }],
} as const;

/** How long the basemap gets before we say it is being slow. */
const LOAD_DEADLINE_MS = 12000;

interface MapLibreMap {
  addControl(control: unknown, position?: string): void;
  fitBounds(bounds: [[number, number], [number, number]], options?: unknown): void;
  flyTo(options: unknown): void;
  resize(): void;
  remove(): void;
  loaded(): boolean;
  on(event: string, handler: (payload?: unknown) => void): void;
}

interface MapLibreMarker {
  setLngLat(coords: [number, number]): MapLibreMarker;
  addTo(map: MapLibreMap): MapLibreMarker;
  remove(): void;
}

interface MapLibreNamespace {
  Map: new (options: Record<string, unknown>) => MapLibreMap;
  Marker: new (options?: Record<string, unknown>) => MapLibreMarker;
  NavigationControl: new (options?: Record<string, unknown>) => unknown;
}

declare global {
  interface Window {
    maplibregl?: MapLibreNamespace;
  }
}

let loaderPromise: Promise<MapLibreNamespace> | null = null;

function loadMapLibre(): Promise<MapLibreNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MapLibre requires a browser"));
  }
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<MapLibreNamespace>((resolve, reject) => {
    if (!document.querySelector(`link[href="${MAPLIBRE_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = MAPLIBRE_CSS;
      document.head.appendChild(link);
    }

    const script = document.createElement("script");
    script.src = MAPLIBRE_JS;
    script.async = true;
    script.onload = () => {
      if (window.maplibregl) resolve(window.maplibregl);
      else reject(new Error("the map library loaded but did not register"));
    };
    script.onerror = () => reject(new Error("could not reach the map library"));
    document.head.appendChild(script);
  });

  return loaderPromise;
}

export interface MapViewProps {
  reports: TrailReport[];
  selectedId: string | null;
  onSelect: (trailId: string) => void;
}

export default function MapView({ reports, selectedId, onSelect }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, { marker: MapLibreMarker; el: HTMLElement }>>(new Map());

  /*
   * Three separate things, which an earlier version collapsed into one and
   * got wrong in both directions.
   *
   * `mapReady` means the map object exists. Markers and fitBounds only need
   * this -- they do not need the basemap -- so gating them on tiles meant a
   * slow tile server hid the pins, which are the actual product.
   *
   * `tilesReady` means the basemap drew. It controls a loading note, nothing
   * more.
   *
   * `failure` is reserved for hard failures: the library could not load, or
   * the map could not be constructed. A slow basemap is not a failure, and
   * treating it as one tore down an in-flight load so every retry restarted
   * the same slow fetch and timed out again.
   */
  const [mapReady, setMapReady] = useState(false);
  const [tilesReady, setTilesReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const retry = useCallback(() => {
    setFailure(null);
    setSlow(false);
    setTilesReady(false);
    setMapReady(false);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    loadMapLibre()
      .then((maplibregl) => {
        if (cancelled || !containerRef.current) return;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: BASEMAP_STYLE,
          center: [-111.7, 40.5],
          zoom: 7.4,
          attributionControl: { compact: true },
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

        // The map object is usable now: markers, camera and interaction all
        // work before a single tile arrives.
        mapRef.current = map;
        setMapReady(true);

        map.on("load", () => {
          if (cancelled) return;
          clearTimeout(deadline);
          setTilesReady(true);
          setSlow(false);
        });

        map.on("error", (payload?: unknown) => {
          // A single tile 404 is not worth a banner; only report if the map
          // never became usable.
          if (cancelled || mapRef.current?.loaded()) return;
          const message =
            payload && typeof payload === "object" && "error" in payload
              ? String((payload as { error?: { message?: string } }).error?.message ?? "")
              : "";
          if (message) console.warn("[trailcast] map error:", message);
        });

        // Note slowness, but never tear the map down for it. The observed
        // failure produced no error event at all, and a late-arriving
        // basemap should simply appear rather than be cancelled.
        deadline = setTimeout(() => {
          if (cancelled || map.loaded()) return;
          setSlow(true);
        }, LOAD_DEADLINE_MS);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(error instanceof Error ? error.message : "The map could not start.");
      });

    return () => {
      cancelled = true;
      clearTimeout(deadline);
      for (const { marker } of markersRef.current.values()) marker.remove();
      markersRef.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [attempt]);

  /*
   * Keep the canvas in step with its container. The panel opening and closing
   * changes the map's width without changing the window's, and MapLibre only
   * watches the window -- so without this the canvas keeps its old width and
   * the map stops short of the space it has.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = typeof window !== "undefined" ? window.maplibregl : undefined;
    if (!map || !maplibregl || !mapReady) return;

    for (const { marker } of markersRef.current.values()) marker.remove();
    markersRef.current.clear();

    for (const report of reports) {
      const el = document.createElement("div");
      el.className = "marker";
      el.style.background = GRADE_COLOR[report.verdict.grade];
      el.textContent =
        report.verdict.score !== undefined ? String(report.verdict.score) : "?";
      el.title = `${report.trail.name} — ${report.verdict.headline}`;
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelectRef.current(report.trail.id);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([report.trail.lon, report.trail.lat])
        .addTo(map);

      markersRef.current.set(report.trail.id, { marker, el });
    }

    if (reports.length > 0) {
      let minLon = Infinity;
      let minLat = Infinity;
      let maxLon = -Infinity;
      let maxLat = -Infinity;

      for (const report of reports) {
        minLon = Math.min(minLon, report.trail.lon);
        maxLon = Math.max(maxLon, report.trail.lon);
        minLat = Math.min(minLat, report.trail.lat);
        maxLat = Math.max(maxLat, report.trail.lat);
      }

      map.fitBounds(
        [
          [minLon, minLat],
          [maxLon, maxLat],
        ],
        { padding: 70, maxZoom: 11, duration: 600 },
      );
    }
  }, [reports, mapReady]);

  useEffect(() => {
    for (const [id, { el }] of markersRef.current.entries()) {
      el.classList.toggle("marker-selected", id === selectedId);
    }

    if (!selectedId) return;
    const target = reports.find((r) => r.trail.id === selectedId);
    if (target && mapRef.current && mapReady) {
      mapRef.current.flyTo({
        center: [target.trail.lon, target.trail.lat],
        zoom: 11,
        duration: 700,
      });
    }
  }, [selectedId, reports, mapReady]);

  if (failure) {
    return (
      <div className="map-fallback">
        <p>{failure}</p>
        <p className="map-fallback-note">
          Every score, reason and source is still on the left — the map is the
          only thing missing.
        </p>
        <button type="button" onClick={retry}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="map" ref={containerRef}>
      {!tilesReady ? (
        <div className={slow ? "map-note map-note-slow" : "map-note"}>
          {slow ? (
            <>
              <span>Basemap is slow to load — pins and scores are live.</span>
              <button type="button" onClick={retry}>
                Reload map
              </button>
            </>
          ) : (
            <span>Loading basemap…</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
