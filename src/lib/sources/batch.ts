import { withCache } from "../cache";
import { asRecord, fetchJson } from "./types";

/**
 * Coalesce Open-Meteo requests.
 *
 * Every grid cell used to cost its own HTTP call, so one page load sent forty
 * near-simultaneous requests from a shared cloud IP -- and Open-Meteo began
 * answering 429, which blanked the weather factors for whichever cells lost
 * the race. That was the "stats not recorded" bug.
 *
 * Open-Meteo accepts a list of coordinates in one request and returns an
 * array in the same order, so callers that arrive within a few milliseconds
 * of each other now share one request. The raw payload is also cached per
 * point, independent of which days were asked for: switching from Saturday to
 * Sunday used to refetch the same seven-day forecast.
 */

interface Pending {
  lat: number;
  lon: number;
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: unknown) => void;
}

export interface BatcherOptions {
  endpoint: string;
  params: Record<string, string>;
  ttlSeconds: number;
  staleSeconds: number;
  /** Locations per request; keeps URLs a sane length. */
  maxPerRequest?: number;
  label: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Build the single-point URL, which is what provenance links point at. */
export function pointUrl(endpoint: string, params: Record<string, string>, lat: number, lon: number): string {
  const search = new URLSearchParams({ latitude: lat.toFixed(4), longitude: lon.toFixed(4), ...params });
  return `${endpoint}?${search.toString()}`;
}

export function createBatcher(options: BatcherOptions) {
  const max = options.maxPerRequest ?? 40;
  let queue: Pending[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function fetchWithRetry(url: string): Promise<unknown> {
    const waits = [0, 1200, 3000];
    let lastError: unknown;
    for (const wait of waits) {
      if (wait) await sleep(wait);
      try {
        return await fetchJson(url, 12_000);
      } catch (error) {
        lastError = error;
        // Only a rate limit or a server hiccup is worth retrying.
        if (!/\b(429|5\d\d)\b/.test(String(error))) break;
      }
    }
    throw lastError;
  }

  async function send(batch: Pending[]) {
    const search = new URLSearchParams({
      latitude: batch.map((p) => p.lat.toFixed(4)).join(","),
      longitude: batch.map((p) => p.lon.toFixed(4)).join(","),
      ...options.params,
    });
    try {
      const body = await fetchWithRetry(`${options.endpoint}?${search.toString()}`);
      const list = Array.isArray(body) ? body : [body];
      batch.forEach((pending, index) => {
        const payload = asRecord(list[index]);
        if (payload) pending.resolve(payload);
        else pending.reject(new Error(`${options.label} returned no data for this point`));
      });
    } catch (error) {
      for (const pending of batch) pending.reject(error);
    }
  }

  function flush() {
    timer = null;
    const waiting = queue;
    queue = [];
    for (let i = 0; i < waiting.length; i += max) void send(waiting.slice(i, i + max));
  }

  function enqueue(lat: number, lon: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      queue.push({ lat, lon, resolve, reject });
      if (!timer) timer = setTimeout(flush, 15);
    });
  }

  return function payloadFor(lat: number, lon: number): Promise<Record<string, unknown>> {
    const cacheKey = `${options.label}|${lat.toFixed(4)},${lon.toFixed(4)}`;
    return withCache(cacheKey, { ttlSeconds: options.ttlSeconds, staleSeconds: options.staleSeconds }, () =>
      enqueue(lat, lon),
    ).then((result) => result.value);
  };
}
