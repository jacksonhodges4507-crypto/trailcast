import { beforeEach, describe, expect, it } from "vitest";
import { cacheSize, clearCache, withCache } from "@/lib/cache";

describe("withCache", () => {
  beforeEach(() => clearCache());

  it("calls the loader once inside the TTL", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return calls;
    };

    const first = await withCache("k", { ttlSeconds: 60 }, load);
    const second = await withCache("k", { ttlSeconds: 60 }, load);

    expect(first.value).toBe(1);
    expect(first.cached).toBe(false);
    expect(second.value).toBe(1);
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);
  });

  it("keys entries independently", async () => {
    await withCache("a", { ttlSeconds: 60 }, async () => "first");
    const b = await withCache("b", { ttlSeconds: 60 }, async () => "second");
    expect(b.value).toBe("second");
    expect(cacheSize()).toBe(2);
  });

  it("serves a stale value when the refresh fails", async () => {
    await withCache("k", { ttlSeconds: 0 }, async () => "warm");

    const result = await withCache(
      "k",
      { ttlSeconds: 0, staleSeconds: 600 },
      async () => {
        throw new Error("upstream down");
      },
    );

    expect(result.value).toBe("warm");
    expect(result.cached).toBe(true);
  });

  it("gives up when the stale window has also passed", async () => {
    await expect(
      withCache("cold", { ttlSeconds: 0, staleSeconds: 0 }, async () => {
        throw new Error("upstream down");
      }),
    ).rejects.toThrow("upstream down");
  });
});
