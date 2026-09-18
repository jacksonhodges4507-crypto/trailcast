import type { SourceRef } from "../types";
import type { LatLon } from "../geo";

export interface SourceContext {
  /** Grid-clustered point the adapter should fetch for. */
  point: LatLon;
  /** ISO dates (YYYY-MM-DD) the caller needs covered. */
  dates: string[];
  signal?: AbortSignal;
}

/**
 * What an adapter returns: a flat bag of normalised readings keyed by
 * `${date}:${field}`, plus one `SourceRef` per key.
 *
 * Keeping the shape flat means the scoring layer never learns an upstream
 * schema, and a new source is a new file rather than a change to the engine.
 */
export interface SourceResult {
  values: Record<string, number | string | undefined>;
  refs: Record<string, SourceRef>;
  /** Free-form extras a single rule understands, e.g. wildfire perimeters. */
  extras?: Record<string, unknown>;
}

export interface SourceAdapter {
  id: string;
  name: string;
  attribution: string;
  homepage: string;
  /** Seconds a response stays fresh. */
  ttlSeconds: number;
  /** Seconds a stale response may still be served after a failed refresh. */
  staleSeconds: number;
  fetch(context: SourceContext): Promise<SourceResult>;
}

export function key(date: string, field: string): string {
  return `${date}:${field}`;
}

/** Fetch with a timeout, so one slow upstream cannot hold the request open. */
export async function fetchJson(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "trailcast/0.1" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} from ${hostOf(url)}`);
    }

    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Narrowing helpers: upstream payloads are `unknown` until proven otherwise. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asNumberArray(value: unknown): (number | null)[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
}

export function asStringArray(value: unknown): (string | null)[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((v) => (typeof v === "string" ? v : null));
}
