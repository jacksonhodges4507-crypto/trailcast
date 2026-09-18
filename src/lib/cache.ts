/**
 * Process-local TTL cache with stale-while-revalidate.
 *
 * On Vercel each warm lambda keeps its own copy, which is the right trade
 * for read-only public data: no external dependency, and a cold start costs
 * one upstream request. A multi-region deployment would swap this module for
 * Redis behind the same three functions.
 */

interface Entry<T> {
  value: T;
  storedAt: number;
}

const store = new Map<string, Entry<unknown>>();

export interface CacheResult<T> {
  value: T;
  cached: boolean;
  ageSeconds: number;
}

export interface CacheOptions {
  /** Seconds a value is served without any upstream call. */
  ttlSeconds: number;
  /**
   * Seconds past the TTL during which a stale value is still returned if the
   * refresh fails. Keeps one flaky upstream from blanking the page.
   */
  staleSeconds?: number;
}

/** Test seam: clears everything. */
export function clearCache(): void {
  store.clear();
}

export function cacheSize(): number {
  return store.size;
}

export async function withCache<T>(
  key: string,
  options: CacheOptions,
  load: () => Promise<T>,
): Promise<CacheResult<T>> {
  const now = Date.now();
  const existing = store.get(key) as Entry<T> | undefined;

  if (existing) {
    const ageSeconds = (now - existing.storedAt) / 1000;
    if (ageSeconds < options.ttlSeconds) {
      return { value: existing.value, cached: true, ageSeconds };
    }
  }

  try {
    const value = await load();
    store.set(key, { value, storedAt: now });
    return { value, cached: false, ageSeconds: 0 };
  } catch (error) {
    if (existing) {
      const ageSeconds = (now - existing.storedAt) / 1000;
      const staleWindow = options.staleSeconds ?? 0;
      if (ageSeconds < options.ttlSeconds + staleWindow) {
        return { value: existing.value, cached: true, ageSeconds };
      }
    }
    throw error;
  }
}
