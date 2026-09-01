import { beforeEach, describe, expect, it } from "vitest";
import { buildId, canonicalPayload, handleBuildsGet, handleBuildsPost, memoryBuildStore, type BuildsContext } from "./builds";
import { memoryLimiter } from "./burst";
import { toResponse } from "./http";
import { caseFixture, cpuFixture, gpuFixture, T0 } from "./fixtures";
import { resetPartIndexCache } from "./payload";
import { memoryRepo } from "./repo-memory";
import { b64urlDecode } from "./session";

const version = { version: 1, publishedAt: T0, snapshotDate: "2026-08-29", summary: "seed" };
let ctx: BuildsContext;
const post = (body: unknown, raw?: string) =>
  handleBuildsPost(new Request("http://x/api/builds", { method: "POST", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body) }), ctx).catch(toResponse);
const bodyOf = async (res: Response) => (await res.json()) as Record<string, any>;

beforeEach(() => {
  resetPartIndexCache();
  ctx = { repo: memoryRepo([caseFixture, cpuFixture, gpuFixture], version), store: memoryBuildStore(), burst: memoryLimiter(100, 60) };
});

describe("POST /api/builds", () => {
  it("returns a deterministic 10-char base32 id and a /b/<id>#b= url; round-trips via GET", async () => {
    const payload = { v: 1, parts: [gpuFixture.id, cpuFixture.id], goal: { useCase: "gaming", budgetUSD: 1500, preferences: { color: "black", noise: "quiet" } } };
    const a = await bodyOf(await post(payload));
    expect(a.ok).toBe(true);
    expect(a.id).toMatch(/^[a-z2-7]{10}$/);
    expect(a.url.startsWith(`/b/${a.id}#b=`)).toBe(true);
    expect(a.transport).toBe("short+fragment");
    // Fragment carries the canonical payload.
    const frag = JSON.parse(new TextDecoder().decode(b64urlDecode(a.url.split("#b=")[1])!));
    expect(frag).toEqual({ v: 1, parts: [cpuFixture.id, gpuFixture.id], goal: { useCase: "gaming", budgetUSD: 1500, preferences: { color: "black", noise: "quiet" } } });

    // Same set in another order / duplicated / different key order → same id.
    const b = await bodyOf(await post({ goal: { preferences: { noise: "quiet", color: "black" }, budgetUSD: 1500, useCase: "gaming" }, parts: [cpuFixture.id, gpuFixture.id, cpuFixture.id], v: 1 }));
    expect(b.id).toBe(a.id);
    expect(await buildId(payload as any)).toBe(a.id);

    const got = await bodyOf(await handleBuildsGet(a.id, ctx));
    expect(got).toMatchObject({ ok: true, id: a.id, payload: frag });
  });

  it("validates: unknown part → 400 UNKNOWN_PART, extra fields / bad goal → 400, > 2 KB → 413", async () => {
    const unknown = await post({ v: 1, parts: ["cpu-ghost"] });
    expect(unknown.status).toBe(400);
    expect((await bodyOf(unknown)).error.code).toBe("UNKNOWN_PART");
    expect((await post({ v: 1, parts: [cpuFixture.id], prompt: "x" })).status).toBe(400);
    expect((await post({ v: 1, parts: [cpuFixture.id], goal: { useCase: "mining", budgetUSD: 1 } })).status).toBe(400);
    expect((await post({ v: 1, parts: [cpuFixture.id, cpuFixture.id, gpuFixture.id] })).status).toBe(200); // dedupe
    expect((await post({ v: 1, parts: [] })).status).toBe(400);
    const big = await post(null, JSON.stringify({ v: 1, parts: Array.from({ length: 24 }, () => "y".repeat(80)), pad: "z".repeat(500) }));
    expect(big.status).toBe(413);
    expect((ctx.store as ReturnType<typeof memoryBuildStore>).map.size).toBe(1);
  });

  it("GET unknown / malformed id → 404; missing KV → fragment-only transport on POST, 503 on GET", async () => {
    expect((await handleBuildsGet("aaaaaaaaaa", ctx).catch(toResponse)).status).toBe(404);
    expect((await handleBuildsGet("../etc", ctx).catch(toResponse)).status).toBe(404);
    ctx.store = null;
    const res = await bodyOf(await post({ v: 1, parts: [cpuFixture.id] }));
    expect(res.transport).toBe("fragment");
    expect((await handleBuildsGet("aaaaaaaaaa", ctx).catch(toResponse)).status).toBe(503);
  });

  it("burst limit → 429", async () => {
    ctx.burst = memoryLimiter(1, 60);
    expect((await post({ v: 1, parts: [cpuFixture.id] })).status).toBe(200);
    expect((await post({ v: 1, parts: [cpuFixture.id] })).status).toBe(429);
  });

  it("canonicalPayload drops undefined preferences and empty objects", () => {
    expect(canonicalPayload({ v: 1, parts: ["b", "a"], goal: { useCase: "office", budgetUSD: 500, preferences: {} } })).toEqual({
      v: 1,
      parts: ["a", "b"],
      goal: { useCase: "office", budgetUSD: 500 },
    });
  });
});
