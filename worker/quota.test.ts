import { describe, expect, it } from "vitest";
import { burstLimiterFor, memoryLimiter } from "./burst";
import { RenderQuota, memoryQuota, parseCap } from "./quota";

describe("RenderQuota daily counters", () => {
  it("atomically enforces the global cap and resets at the next UTC day", async () => {
    let now = new Date("2026-08-30T23:59:30.000Z");
    const q = memoryQuota(2, 10, () => now);
    expect(await q.consume("device-a", "render-a")).toMatchObject({ allowed: true, globalRemaining: 1, userRemaining: 9, day: "2026-08-30" });
    expect(await q.consume("device-b", "render-b")).toMatchObject({ allowed: true, globalRemaining: 0, userRemaining: 9 });
    const denied = await q.consume("device-c", "render-c");
    expect(denied).toMatchObject({ allowed: false, reason: "global", globalRemaining: 0, retryAfterSec: 30 });
    now = new Date("2026-08-31T00:00:01.000Z");
    expect(await q.consume("device-a", "render-d")).toMatchObject({ allowed: true, globalRemaining: 1, userRemaining: 9, day: "2026-08-31" });
  });

  it("limits each anonymous device to 10 while leaving other devices and the global count isolated", async () => {
    const q = memoryQuota(50, 10, () => new Date("2026-08-30T12:00:00.000Z"));
    for (let i = 0; i < 10; i++) expect((await q.consume("device-a", `render-a-${i}`)).allowed).toBe(true);
    expect(await q.consume("device-a", "render-a-10")).toMatchObject({ allowed: false, reason: "user", userLimit: 10, userRemaining: 0, globalRemaining: 40 });
    expect(await q.consume("device-b", "render-b-0")).toMatchObject({ allowed: true, userRemaining: 9, globalRemaining: 39 });
  });

  it("leases a render hash so a concurrent duplicate consumes no additional allowance", async () => {
    const q = memoryQuota(20, 10, () => new Date("2026-08-30T12:00:00.000Z"));
    expect(await q.consume("device-a", "same-hash")).toMatchObject({ allowed: true, userRemaining: 9, globalRemaining: 19 });
    expect(await q.consume("device-b", "same-hash")).toMatchObject({ allowed: false, reason: "in_flight", userRemaining: 10, globalRemaining: 19 });
    await q.release("same-hash");
    expect(await q.consume("device-b", "same-hash")).toMatchObject({ allowed: true, userRemaining: 9, globalRemaining: 18 });
  });

  it("cap 0 denies everything; parseCap uses the supplied fallback on garbage", async () => {
    const q = memoryQuota(0, 10);
    expect(await q.consume("device-a", "render-a")).toMatchObject({ allowed: false, reason: "global" });
    expect(parseCap("abc")).toBe(200);
    expect(parseCap(undefined, 10)).toBe(10);
    expect(parseCap("50")).toBe(50);
  });

  it("the DO class accepts consume/status/release requests with the same semantics", async () => {
    const store = new Map<string, unknown>();
    const state = {
      storage: {
        get: async (k: string) => store.get(k),
        put: async (k: string, v: unknown) => void store.set(k, v),
      },
    } as unknown as DurableObjectState;
    const dobj = new RenderQuota(state, { RENDER_DAILY_CAP: "3", RENDER_USER_DAILY_CAP: "1" });
    const post = (path: string, body: Record<string, string>) =>
      dobj.fetch(new Request(`https://quota${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    const first = await (await post("/consume", { uid: "device-a", renderId: "render-a" })).json();
    const second = await (await post("/consume", { uid: "device-a", renderId: "render-b" })).json();
    expect(first).toMatchObject({ allowed: true, userRemaining: 0, globalRemaining: 2 });
    expect(second).toMatchObject({ allowed: false, reason: "user", globalRemaining: 2 });
    expect(await (await post("/status", { uid: "device-b" })).json()).toMatchObject({ allowed: true, userRemaining: 1, globalRemaining: 2 });
    expect((await dobj.fetch(new Request("https://quota/nope"))).status).toBe(400);
  });
});

describe("burst limiter", () => {
  it("in-memory fallback allows `limit` per window per key", async () => {
    let t = 0;
    const l = memoryLimiter(2, 60, () => t);
    expect(await l.allow("a")).toBe(true);
    expect(await l.allow("a")).toBe(true);
    expect(await l.allow("a")).toBe(false);
    expect(await l.allow("b")).toBe(true);
    t = 61_000;
    expect(await l.allow("a")).toBe(true);
  });

  it("uses the binding when present", async () => {
    const keys: string[] = [];
    const rl = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) } as RateLimit;
    expect(await burstLimiterFor(rl).allow("1.2.3.4")).toBe(false);
    expect(keys).toEqual(["1.2.3.4"]);
    expect(await burstLimiterFor(undefined).allow("x")).toBe(true);
  });
});
