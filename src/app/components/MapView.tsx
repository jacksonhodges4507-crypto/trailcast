"use client";

import { useEffect, useRef, useState } from "react";
import type { TrailReport } from "@/lib/types";
import { GRADE_COLOR } from "./grade";

/**
 * MapLibre is loaded from a CDN at runtime rather than bundled.
 *
 * It is a ~900 kB dependency used by exactly one component, and loading it
 * lazily keeps it off the critical path for the list view — which is the part
 * of the page that actually has to work. If the CDN or the tile host is
 * unreachable the component degrades to a message and the rest of the app is
 * unaffected.
 */

const MAPLIBRE_JS = "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js";
const MAPLIBRE_CSS = "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css";
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** The slice of the MapLibre API this component actually uses. */
interface MapLibreMap {
  addControl(control: unknown, position?: string): void;
  fitBounds(bounds: [[number, number], [number, number]], options?: unknown): void;
  flyTo(options: unknown): void;
  remove(): void;
  on(event: string, handler: () => void): void;
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
      else reject(new Error("MapLibre loaded but did not register"));
    };
    script.onerror = () => reject(new Error("Could not load the map library"));
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
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Keep the latest click handler without re-creating markers on every render.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let cancelled = false;

    loadMapLibre()
      .then((maplibregl) => {
        if (cancelled || !containerRef.current || mapRef.current) return;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: STYLE_URL,
          center: [-111.7, 40.5],
          zoom: 7.4,
          attributionControl: { compact: true },
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.on("load", () => {
          if (!cancelled) setReady(true);
        });

        mapRef.current = map;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      for (const { marker } of markersRef.current.values()) marker.remove();
      markersRef.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Rebuild markers whenever the scored set changes.
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = typeof window !== "undefined" ? window.maplibregl : undefined;
    if (!map || !maplibregl || !ready) return;

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
  }, [reports, ready]);

  // Selection is a class toggle plus a fly-to, not a marker rebuild.
  useEffect(() => {
    for (const [id, { el }] of markersRef.current.entries()) {
      el.classList.toggle("marker-selected", id === selectedId);
    }

    if (!selectedId) return;
    const target = reports.find((r) => r.trail.id === selectedId);
    if (target && mapRef.current) {
      mapRef.current.flyTo({
        center: [target.trail.lon, target.trail.lat],
        zoom: 11,
        duration: 700,
      });
    }
  }, [selectedId, reports]);

  if (failed) {
    return (
      <div className="map-fallback">
        The map could not load, so the list is showing instead.
        <br />
        Every score and source is still available on the left.
      </div>
    );
  }

  return <div className="map" ref={containerRef} />;
}
