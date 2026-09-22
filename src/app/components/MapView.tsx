"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityId, TrailReport } from "@/lib/types";
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
 * OpenFreeMap's vector style: free, keyless, and explicitly unmetered.
 *
 * A detour through CARTO's raster tiles is worth recording, because the
 * failure was instructive. CARTO now gates its basemaps behind an API key,
 * and rather than returning 401s it serves tile images reading "API KEY
 * REQUIRED" -- so every request succeeded, the map reported itself loaded,
 * and the only way to find out was to look at the rendered pixels. A green
 * network panel proved nothing.
 *
 * The real lesson was elsewhere anyway: the original basemap was fine, and
 * what made its occasional slowness look like a dead map was this component
 * gating the markers on it. That is fixed below, and it is what actually
 * matters -- a basemap is a backdrop, and the pins should never wait for it.
 */
const STYLE_URL = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;

type Theme = keyof typeof STYLE_URL;

function currentTheme(): Theme {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark" || explicit === "light") return explicit;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** How long the basemap gets before we say it is being slow. */
const LOAD_DEADLINE_MS = 12000;

/** The slice of the MapLibre API this component actually uses. */
interface MapLibreMap {
  addControl(control: unknown, position?: string): void;
  fitBounds(bounds: [[number, number], [number, number]], options?: unknown): void;
  flyTo(options: unknown): void;
  resize(): void;
  remove(): void;
  setStyle(style: string): void;
  loaded(): boolean;
  on(event: string, handler: (payload?: unknown) => void): void;
  on(event: string, layer: string, handler: (payload?: unknown) => void): void;
  addSource(id: string, source: Record<string, unknown>): void;
  getSource(id: string): { setData(data: unknown): void } | undefined;
  addLayer(layer: Record<string, unknown>): void;
  getLayer(id: string): unknown;
  getCanvas(): HTMLCanvasElement;
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

/**
 * Load the library once, from a CDN, and share the promise. Bundling a
 * ~900 kB dependency used by one component would put it on the critical path
 * for the list view, which is the part that has to work.
 */
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
  /** Which activity is on screen; decides what the map draws. */
  activity?: ActivityId;
}

/** Trail and river lines, keyed by place id: each an array of [lon, lat] runs. */
type LineIndex = Record<string, [number, number][][]>;
/** Climbing walls, keyed by area id: [lon, lat, name, route count]. */
type WallIndex = Record<string, [number, number, string, number][]>;

/** Shared across mounts: a place's shape does not change during a visit. */
const geoCache = new Map<string, { lines: [number, number][][]; walls: [number, number, string, number][] }>();
const geoRequested = new Set<string>();

/** Resolve a `var(--token)` colour, since WebGL paint cannot read CSS. */
function cssColor(value: string): string {
  const match = value.match(/var\((--[\w-]+)\)/);
  if (!match || typeof document === "undefined") return value;
  return getComputedStyle(document.documentElement).getPropertyValue(match[1]!).trim() || "#5e8c3a";
}

export default function MapView({ reports, selectedId, onSelect, activity }: MapViewProps) {
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
          style: STYLE_URL[currentTheme()],
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
      wallHandlersRef.current = false;
    };
  }, [attempt]);

  /*
   * Dark mode used to be a CSS filter (invert + hue-rotate) over the map
   * canvas. A filter on a WebGL canvas makes the compositor repaint the whole
   * thing on every frame of a pan, which is a large part of why dragging the
   * map felt heavy. OpenFreeMap publishes a real dark style, so the map now
   * swaps styles on a theme change and draws dark natively, at no per-frame
   * cost. Markers are DOM elements, so a style swap leaves them untouched.
   */
  useEffect(() => {
    if (!mapReady) return;
    let applied = currentTheme();

    const sync = () => {
      const next = currentTheme();
      if (next === applied) return;
      applied = next;
      mapRef.current?.setStyle(STYLE_URL[next]);
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener?.("change", sync);

    return () => {
      observer.disconnect();
      media?.removeEventListener?.("change", sync);
    };
  }, [mapReady]);

  /*
   * Keep the canvas in step with its container. The panel opening and closing
   * changes the map's width without changing the window's, and MapLibre only
   * watches the window -- so without this the canvas keeps its old width and
   * the map stops short of the space it has.
   */
  const refitRef = useRef<() => void>(() => {});

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    // On phones the map lives in its own tab and starts hidden (zero size).
    // When it first becomes visible, re-fit so the pins are framed properly.
    let lastWidth = container.clientWidth;
    const observer = new ResizeObserver(() => {
      mapRef.current?.resize();
      const width = container.clientWidth;
      if (lastWidth === 0 && width > 0) refitRef.current();
      lastWidth = width;
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [mapReady]);

  /*
   * What the place actually is, drawn on the map: the trail itself for
   * hiking, running and riding, the fishable stretch of river for fishing,
   * and every wall with recorded routes for climbing. Pins alone said where
   * a place was; these say what you would be doing there.
   *
   * A style swap (the dark-mode toggle) throws away every source and layer,
   * so the drawing lives in one function that can be re-run whenever the
   * style reloads, rather than in the effect body.
   */
  const [overlays, setOverlays] = useState<{ lines: LineIndex; walls: WallIndex } | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Late arrivals from an earlier activity still land in the shared cache,
    // and still redraw -- the draw only picks the ids currently on screen.
    const publish = () => {
      if (!aliveRef.current) return;
      const lines: LineIndex = {};
      const walls: WallIndex = {};
      for (const [id, geo] of geoCache) {
        lines[id] = geo.lines;
        walls[id] = geo.walls;
      }
      setOverlays({ lines, walls });
    };
    publish();

    // Ask for each visible place once, a few at a time, and draw as they land.
    const queue = reports.map((r) => r.trail.id).filter((id) => !geoRequested.has(id));
    queue.forEach((id) => geoRequested.add(id));
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        try {
          const response = await fetch(`/api/geo?id=${encodeURIComponent(id)}`);
          const body = (await response.json()) as {
            lines?: [number, number][][];
            walls?: [number, number, string, number][];
            unavailable?: boolean;
          };
          if (body.unavailable) geoRequested.delete(id); // try again on the next visit to this view
          geoCache.set(id, { lines: body.lines ?? [], walls: body.walls ?? [] });
          publish();
        } catch {
          geoRequested.delete(id);
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
  }, [reports]);

  const wallHandlersRef = useRef(false);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const drawRef = useRef<() => void>(() => {});
  drawRef.current = () => {
    const map = mapRef.current;
    if (!map || !overlays) return;

    const lineFeatures: unknown[] = [];
    const wallFeatures: unknown[] = [];

    for (const report of reports) {
      const id = report.trail.id;
      const color = cssColor(GRADE_COLOR[report.verdict.grade]);
      const selected = id === selectedId;

      if (activity === "climb") {
        for (const [lon, lat, name, count] of overlays.walls[id] ?? []) {
          wallFeatures.push({
            type: "Feature",
            properties: { id, name: `${name} (${count})`, color, sel: selected ? 1 : 0 },
            geometry: { type: "Point", coordinates: [lon, lat] },
          });
        }
      } else {
        const runs = overlays.lines[id];
        if (runs && runs.length > 0) {
          lineFeatures.push({
            type: "Feature",
            properties: { id, color, sel: selected ? 1 : 0 },
            geometry: { type: "MultiLineString", coordinates: runs },
          });
        }
      }
    }

    const lines = { type: "FeatureCollection", features: lineFeatures };
    const walls = { type: "FeatureCollection", features: wallFeatures };

    try {
      const lineSource = map.getSource("tc-lines");
      if (lineSource) lineSource.setData(lines);
      else {
        map.addSource("tc-lines", { type: "geojson", data: lines });
        map.addLayer({
          id: "tc-lines-casing",
          type: "line",
          source: "tc-lines",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#ffffff",
            "line-opacity": 0.7,
            "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 7],
          },
        });
        map.addLayer({
          id: "tc-lines",
          type: "line",
          source: "tc-lines",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-opacity": ["case", ["==", ["get", "sel"], 1], 1, 0.8],
            "line-width": [
              "interpolate", ["linear"], ["zoom"],
              8, ["case", ["==", ["get", "sel"], 1], 3, 1.6],
              14, ["case", ["==", ["get", "sel"], 1], 6, 3.5],
            ],
          },
        });
      }

      const wallSource = map.getSource("tc-walls");
      if (wallSource) wallSource.setData(walls);
      else {
        map.addSource("tc-walls", { type: "geojson", data: walls });
        map.addLayer({
          id: "tc-walls",
          type: "circle",
          source: "tc-walls",
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 13, 5, 16, 8],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": ["case", ["==", ["get", "sel"], 1], 2, 1],
            "circle-opacity": ["case", ["==", ["get", "sel"], 1], 1, 0.75],
          },
        });
        map.addLayer({
          id: "tc-wall-labels",
          type: "symbol",
          source: "tc-walls",
          minzoom: 12.5,
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 11,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
            "text-optional": true,
          },
          paint: {
            "text-color": "#2a332c",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.4,
          },
        });
      }

      // Layer-bound handlers outlive a style swap, so bind them once.
      if (!wallHandlersRef.current) {
        wallHandlersRef.current = true;
        map.on("click", "tc-walls", (payload?: unknown) => {
          const features = (payload as { features?: { properties?: { id?: string } }[] })?.features;
          const id = features?.[0]?.properties?.id;
          // Opening an area, never closing it: a wall click is always "show me this".
          if (id && id !== selectedRef.current) onSelectRef.current(id);
        });
        map.on("mouseenter", "tc-walls", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "tc-walls", () => {
          map.getCanvas().style.cursor = "";
        });
      }
    } catch {
      // The style is mid-load; the styledata listener below redraws once it lands.
    }
  };

  useEffect(() => {
    drawRef.current();
  }, [overlays, reports, selectedId, activity, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    // Fires after every style (re)load, including the dark-mode swap.
    map.on("styledata", () => {
      if (!map.getLayer("tc-lines") || !map.getLayer("tc-walls")) drawRef.current();
    });
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = typeof window !== "undefined" ? window.maplibregl : undefined;
    if (!map || !maplibregl || !mapReady) return;

    for (const { marker } of markersRef.current.values()) marker.remove();
    markersRef.current.clear();

    for (const report of reports) {
      /*
       * Two elements, on purpose. MapLibre positions a marker by writing a
       * CSS transform onto the element it is given, every frame the map
       * moves. The hover effect used to put `transition: transform` and a
       * `scale()` on that same element, so every pin spent each frame easing
       * toward where it should already have been -- forty of them, on every
       * frame of every pan. That was the lag. The outer element now belongs
       * to MapLibre and carries no styling of its own; the visible dot, its
       * hover scale and its transition all live on the inner child.
       */
      const el = document.createElement("div");
      el.className = "marker";
      const dot = document.createElement("div");
      dot.className = "marker-dot";
      dot.style.background = GRADE_COLOR[report.verdict.grade];
      dot.textContent =
        report.verdict.score !== undefined ? String(report.verdict.score) : "?";
      el.appendChild(dot);
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

    refitRef.current = () => fit(0);
    fit(600);

    function fit(duration: number) {
      if (!map || reports.length === 0) return;
      const target = reports.find((r) => r.trail.id === selectedRef.current);
      if (target) {
        map.flyTo({ center: [target.trail.lon, target.trail.lat], zoom: 11, duration });
        return;
      }
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
        { padding: 70, maxZoom: 11, duration },
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
