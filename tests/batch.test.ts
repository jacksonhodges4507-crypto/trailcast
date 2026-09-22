import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBatcher } from "@/lib/sources/batch";
import { clearCache } from "@/lib/cache";

function stub(handler: (url: string) => { status: number; body: unknown }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const { status, body } = handler(url);
    return {
      ok: status < 400,
      status,
      statusText: status === 429 ? "Too Many Requests" : "OK",
      json: async () => body,
    } as unknown as Response;
  });
  return calls;
}

beforeEach(() => clearCache());
afterEach(() => vi.unstubAllGlobals());

describe("Open-Meteo batching", () => {
  it("sends points that arrive together as one request and splits the answer", async () => {
    const calls = stub(() => ({ status: 200, body: [{ id: "a" }, { id: "b" }] }));
    const payloadFor = createBatcher({ endpoint: "https://x.test/v1", params: {}, ttlSeconds: 60, staleSeconds: 0, label: "t1" });

    const [a, b] = await Promise.all([payloadFor(40, -111), payloadFor(41, -112)]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("latitude=40.0000%2C41.0000");
    expect(a).toEqual({ id: "a" });
    expect(b).toEqual({ id: "b" });
  });

  it("serves a repeat point from cache without a request", async () => {
    const calls = stub(() => ({ status: 200, body: { id: "only" } }));
    const payloadFor = createBatcher({ endpoint: "https://x.test/v1", params: {}, ttlSeconds: 60, staleSeconds: 0, label: "t2" });
    await payloadFor(40, -111);
    await payloadFor(40, -111);
    expect(calls).toHaveLength(1);
  });

  it("retries a rate limit instead of dropping the data", async () => {
    let n = 0;
    const calls = stub(() => (++n === 1 ? { status: 429, body: {} } : { status: 200, body: { id: "late" } }));
    const payloadFor = createBatcher({ endpoint: "https://x.test/v1", params: {}, ttlSeconds: 60, staleSeconds: 0, label: "t3" });
    expect(await payloadFor(40, -111)).toEqual({ id: "late" });
    expect(calls).toHaveLength(2);
  });
});
