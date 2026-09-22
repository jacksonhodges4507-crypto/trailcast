import type { StoredReport } from "./kinds";

/**
 * Where reports live.
 *
 * With Upstash Redis attached to the Vercel project (its integration injects
 * KV_REST_API_URL and KV_REST_API_TOKEN), reports are shared by every visitor
 * and survive deploys. Without it, they fall back to process memory, which
 * works for a demo but is per-server and forgotten on redeploy -- so the API
 * reports which backend answered and the UI says so, rather than presenting
 * throwaway data as a shared record.
 *
 * Upstash is used through its REST interface, which is a single fetch per
 * command and needs no client library.
 */

export interface ReportStore {
  kind: "redis" | "memory";
  append(trailId: string, report: StoredReport): Promise<void>;
  list(trailId: string): Promise<StoredReport[]>;
  /** Increment a counter that expires; returns the new count. */
  hit(key: string, windowSeconds: number): Promise<number>;
}

const KEEP = 200;
const RETAIN_SECONDS = 7 * 24 * 3600;

function parseReport(raw: unknown): StoredReport | null {
  if (typeof raw !== "string") return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredReport>;
    if (typeof value.kind !== "string" || typeof value.at !== "string" || typeof value.who !== "string") {
      return null;
    }
    return {
      kind: value.kind,
      at: value.at,
      who: value.who,
      note: typeof value.note === "string" ? value.note : undefined,
    };
  } catch {
    return null;
  }
}

function redisStore(url: string, token: string): ReportStore {
  const base = url.replace(/\/$/, "");

  async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
    const response = await fetch(`${base}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(commands.map((c) => c.map(String))),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Report store answered ${response.status}`);
    const body = (await response.json()) as { result?: unknown; error?: string }[];
    return body.map((entry) => {
      if (entry.error) throw new Error(entry.error);
      return entry.result;
    });
  }

  return {
    kind: "redis",
    async append(trailId, report) {
      const key = `reports:${trailId}`;
      await pipeline([
        ["LPUSH", key, JSON.stringify(report)],
        ["LTRIM", key, 0, KEEP - 1],
        ["EXPIRE", key, RETAIN_SECONDS],
      ]);
    },
    async list(trailId) {
      const [result] = await pipeline([["LRANGE", `reports:${trailId}`, 0, KEEP - 1]]);
      return Array.isArray(result)
        ? result.map(parseReport).filter((r): r is StoredReport => r !== null)
        : [];
    },
    async hit(key, windowSeconds) {
      const [count] = await pipeline([
        ["INCR", `rl:${key}`],
        ["EXPIRE", `rl:${key}`, windowSeconds, "NX"],
      ]);
      return typeof count === "number" ? count : Number(count) || 0;
    },
  };
}

function memoryStore(): ReportStore {
  const lists = new Map<string, StoredReport[]>();
  const counters = new Map<string, { count: number; expires: number }>();

  return {
    kind: "memory",
    async append(trailId, report) {
      const list = lists.get(trailId) ?? [];
      list.unshift(report);
      lists.set(trailId, list.slice(0, KEEP));
    },
    async list(trailId) {
      return [...(lists.get(trailId) ?? [])];
    },
    async hit(key, windowSeconds) {
      const now = Date.now();
      const entry = counters.get(key);
      if (!entry || entry.expires < now) {
        counters.set(key, { count: 1, expires: now + windowSeconds * 1000 });
        return 1;
      }
      entry.count += 1;
      return entry.count;
    },
  };
}

let singleton: ReportStore | null = null;

export function reportStore(): ReportStore {
  if (singleton) return singleton;
  const url = process.env["KV_REST_API_URL"] ?? process.env["UPSTASH_REDIS_REST_URL"];
  const token = process.env["KV_REST_API_TOKEN"] ?? process.env["UPSTASH_REDIS_REST_TOKEN"];
  singleton = url && token ? redisStore(url, token) : memoryStore();
  return singleton;
}

/** Test seam. */
export function setReportStore(store: ReportStore | null): void {
  singleton = store;
}
