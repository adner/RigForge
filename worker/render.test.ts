import { beforeEach, describe, expect, it } from "vitest";
import { buildHashInput } from "../src/engine/renderPrompt";
import { memoryLimiter } from "./burst";
import { memoryCardStore, type MemoryCardStore } from "./card-store";
import { ApiError, toResponse } from "./http";
import { fakeProvider, WEBP_MAGIC, type FakeProvider } from "./image-provider";
import { caseFixture, cpuFixture, gpuFixture, ramFixture, T0 } from "./fixtures";
import { resetPartIndexCache, sha256Hex } from "./payload";
import { memoryQuota } from "./quota";
import { handleRenderGet, handleRenderPost, type RenderContext } from "./render";
import { memoryStore, type MemoryRenderStore } from "./render-store";
import { memoryRepo } from "./repo-memory";
import { signSession, SESSION_COOKIE } from "./session";

const KEY = "render-test-key";
const NOW = new Date("2026-08-30T12:00:00.000Z");
const version = { version: 1, publishedAt: T0, snapshotDate: "2026-08-29", summary: "seed" };

let ctx: RenderContext;
let store: MemoryRenderStore;
let provider: FakeProvider;
let cookie: string;

const post = async (body: unknown, opts: { cookie?: string | null; raw?: string; ip?: string } = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie !== null) headers.cookie = `${SESSION_COOKIE}=${opts.cookie ?? cookie}`;
  if (opts.ip) headers["cf-connecting-ip"] = opts.ip;
  const req = new Request("http://x/api/render", { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) });
  return handleRenderPost(req, ctx).catch(toResponse);
};
const bodyOf = async (res: Response) => (await res.json()) as Record<string, any>;
const GOOD = { v: 1, partIds: [caseFixture.id, cpuFixture.id, gpuFixture.id, ramFixture.id], style: "photoreal", angle: "front" };

beforeEach(async () => {
  resetPartIndexCache();
  store = memoryStore();
  provider = fakeProvider();
  cookie = await signSession(KEY, "device-render", NOW);
  ctx = {
    repo: memoryRepo([caseFixture, cpuFixture, gpuFixture, ramFixture], version),
    store,
    provider,
    quota: memoryQuota(2, 10, () => NOW),
    burst: memoryLimiter(100, 60),
    sessionKey: KEY,
    now: () => NOW,
  };
});

describe("POST /api/render", () => {
  it("requires the session cookie (403 VERIFICATION_REQUIRED) before anything else", async () => {
    const res = await post(GOOD, { cookie: null });
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error.code).toBe("VERIFICATION_REQUIRED");
    expect(provider.calls).toHaveLength(0);
  });

  it("renders on a cache miss: server-computed hash, stores in R2 with metadata, returns the prompt", async () => {
    const res = await post(GOOD);
    expect(res.status).toBe(200);
    const b = await bodyOf(res);
    const expected = await sha256Hex(
      buildHashInput({ slots: { case: [caseFixture], cpu: [cpuFixture], gpu: [gpuFixture], ram: [ramFixture] } }, undefined, "photoreal", "front"),
    );
    expect(b).toMatchObject({ ok: true, renderId: expected, buildHash: expected, imageUrl: `/api/render/${expected}.webp`, cached: false });
    expect(b.promptUsed).toBe(provider.calls[0]);
    expect(b.promptUsed).not.toMatch(/Testbrand|Test 5060/); // attributes only, no names
    expect(store.objects.get(expected)).toMatchObject({ contentType: "image/webp", meta: { buildHash: expected, style: "photoreal", angle: "front", createdAt: NOW.toISOString() } });
  });

  it("forged prompt / buildHash fields are rejected and never influence the hash", async () => {
    const forged = await post({ ...GOOD, prompt: "a dragon", buildHash: "f".repeat(64) });
    expect(forged.status).toBe(400);
    expect((await bodyOf(forged)).error.code).toBe("INVALID_INPUT");
    expect(provider.calls).toHaveLength(0);
    // Same parts in a different order → same server-side hash.
    const a = await bodyOf(await post(GOOD));
    const b = await bodyOf(await post({ ...GOOD, partIds: [...GOOD.partIds].reverse() }));
    expect(b.buildHash).toBe(a.buildHash);
    expect(b.cached).toBe(true);
  });

  it("unknown part id → 400 UNKNOWN_PART; bad enums → 400 INVALID_INPUT; no case → 400 RENDER_NEEDS_CASE", async () => {
    const unknown = await post({ ...GOOD, partIds: [caseFixture.id, "gpu-nope"] });
    expect(unknown.status).toBe(400);
    expect((await bodyOf(unknown)).error).toMatchObject({ code: "UNKNOWN_PART", details: { partIds: ["gpu-nope"] } });

    expect((await post({ ...GOOD, style: "anime" })).status).toBe(400);
    expect((await post({ ...GOOD, goal: { useCase: "gaming", budgetUSD: 1500, preferences: { lighting: "disco" } } })).status).toBe(400);
    expect((await post({ ...GOOD, v: 2 })).status).toBe(400);

    const noCase = await post({ ...GOOD, partIds: [cpuFixture.id, gpuFixture.id] });
    expect(noCase.status).toBe(400);
    expect((await bodyOf(noCase)).error.code).toBe("RENDER_NEEDS_CASE");

    const twoCpus = await post({ ...GOOD, partIds: [caseFixture.id, cpuFixture.id, cpuFixture.id] }); // dup is deduped → fine
    expect(twoCpus.status).toBe(200);
    expect(provider.calls).toHaveLength(1);
  });

  it("oversized body → 413 BODY_TOO_LARGE (2 KB cap)", async () => {
    const raw = JSON.stringify({ ...GOOD, partIds: Array.from({ length: 30 }, () => "x".repeat(80)) });
    expect(raw.length).toBeGreaterThan(2048);
    const res = await post(null, { raw });
    expect(res.status).toBe(413);
    expect((await bodyOf(res)).error.code).toBe("BODY_TOO_LARGE");
  });

  it("cache hit skips provider and quota", async () => {
    await post(GOOD);
    expect(provider.calls).toHaveLength(1);
    const q = ctx.quota as ReturnType<typeof memoryQuota>;
    expect(await q.status("device-render")).toMatchObject({ userRemaining: 9, globalRemaining: 1 });
    const hit = await bodyOf(await post(GOOD));
    expect(hit.cached).toBe(true);
    expect(hit.promptUsed).toBeUndefined();
    expect(provider.calls).toHaveLength(1);
    expect(await q.status("device-render")).toMatchObject({ userRemaining: 9, globalRemaining: 1 });
  });

  it("accepts bounded cosmetic flair, includes it in the server hash, and keeps variants distinct", async () => {
    const flair = "a small illustrated turtle sticker on the glass side panel";
    const first = await bodyOf(await post({ ...GOOD, flair }));
    const expected = await sha256Hex(
      buildHashInput({ slots: { case: [caseFixture], cpu: [cpuFixture], gpu: [gpuFixture], ram: [ramFixture] } }, undefined, "photoreal", "front", flair),
    );
    expect(first).toMatchObject({ ok: true, buildHash: expected, renderId: expected, cached: false });
    expect(first.promptUsed).toContain(flair);
    expect(first.promptUsed).toContain("do not change, remove or invent PC hardware");

    const plain = await bodyOf(await post(GOOD));
    expect(plain.buildHash).not.toBe(first.buildHash);
    expect(plain.cached).toBe(false);
    expect(provider.calls).toHaveLength(2);

    expect((await post({ ...GOOD, flair: "line one\nline two" })).status).toBe(400);
    expect((await post({ ...GOOD, flair: "x".repeat(201) })).status).toBe(400);
  });

  it("global quota exhaustion → distinct 429 with retryAfterSec; nothing stored", async () => {
    ctx.quota = memoryQuota(0, 10, () => NOW);
    const res = await post(GOOD);
    expect(res.status).toBe(429);
    const b = await bodyOf(res);
    expect(b.error.code).toBe("RENDER_GLOBAL_DAILY_LIMIT");
    expect(b.error.details.retryAfterSec).toBe(12 * 3600);
    expect(provider.calls).toHaveLength(0);
    expect(store.objects.size).toBe(0);
  });

  it("burst limit → 429 before the body is validated", async () => {
    ctx.burst = memoryLimiter(1, 60);
    expect((await post(GOOD, { ip: "9.9.9.9" })).status).toBe(200);
    const res = await post({ garbage: true }, { ip: "9.9.9.9" });
    expect(res.status).toBe(429);
    expect((await post(GOOD, { ip: "8.8.8.8" })).status).toBe(200);
  });

  it("missing IMAGE_API_KEY → 503 RENDER_UNAVAILABLE on a miss (a cached hash still serves)", async () => {
    const first = await bodyOf(await post(GOOD));
    ctx.provider = null;
    expect((await bodyOf(await post(GOOD))).cached).toBe(true);
    const miss = await post({ ...GOOD, angle: "side" });
    expect(miss.status).toBe(503);
    expect((await bodyOf(miss)).error.code).toBe("RENDER_UNAVAILABLE");
    expect(first.cached).toBe(false);
  });

  it("provider failures map to RENDER_FAILED and nothing is stored", async () => {
    provider.fail = new ApiError(504, "RENDER_FAILED", "Image generation timed out");
    const res = await post(GOOD);
    expect(res.status).toBe(504);
    expect((await bodyOf(res)).error.code).toBe("RENDER_FAILED");
    expect(store.objects.size).toBe(0);
  });
});

describe("POST /api/render — composed mode (part cards, docs/RENDER_FIDELITY.md Phase 2)", () => {
  let cards: MemoryCardStore;
  const build = { slots: { case: [caseFixture], cpu: [cpuFixture], gpu: [gpuFixture], ram: [ramFixture] } };
  const textHash = () => sha256Hex(buildHashInput(build, undefined, "photoreal", "front"));
  const composedHash = (keys: string[]) => sha256Hex(buildHashInput(build, undefined, "photoreal", "front", undefined, keys));

  beforeEach(() => {
    cards = memoryCardStore();
    ctx.cards = cards;
  });

  const publishAll = () => [caseFixture.id, gpuFixture.id, ramFixture.id].map((id) => cards.add(id));

  it("composes when every card-category part in the build has a card, in case → gpu → cooler → ram order", async () => {
    const keys = publishAll();
    const b = await bodyOf(await post(GOOD));
    expect(b.mode).toBe("composed");
    // The cpu has no card and is not a card category — it must not appear in the reference set.
    expect(provider.composeCalls).toHaveLength(1);
    expect(provider.composeCalls[0].images).toBe(3);
    expect(provider.composeCalls[0].contentTypes).toEqual(["image/png", "image/png", "image/png"]);
    expect(b.promptUsed).toBe(provider.composeCalls[0].prompt);
    expect(b.promptUsed).toContain("image 1 is the case, image 2 is the graphics card, image 3 is the memory modules");
    expect(b.promptUsed).not.toMatch(/Testbrand|Test 5060/);

    // renderId / imageUrl address the composed image; buildHash stays the client-recomputable
    // build identity so the page can still tell active from superseded.
    expect(b.renderId).toBe(await composedHash(keys));
    expect(b.buildHash).toBe(await textHash());
    expect(b.imageUrl).toBe(`/api/render/${b.renderId}.webp`);
    expect(store.objects.get(b.renderId)!.meta.mode).toBe("composed");
  });

  it("falls back to the text path when any present part lacks a card (never fails the render)", async () => {
    cards.add(caseFixture.id);
    cards.add(gpuFixture.id); // ram has no card
    const b = await bodyOf(await post(GOOD));
    expect(b.mode).toBe("text");
    expect(provider.composeCalls).toHaveLength(0);
    expect(provider.calls).toHaveLength(1);
    expect(b.renderId).toBe(await textHash());
  });

  it("anonymous device quota exhaustion → clear 10-render error without touching the provider", async () => {
    ctx.quota = memoryQuota(200, 0, () => NOW);
    const res = await post(GOOD);
    expect(res.status).toBe(429);
    const b = await bodyOf(res);
    expect(b.error).toMatchObject({
      code: "RENDER_USER_DAILY_LIMIT",
      details: { userLimit: 0, userRemaining: 0, globalRemaining: 200, resetsAt: "2026-08-31T00:00:00.000Z" },
    });
    expect(b.error.message).toContain("used all 0 renders");
    expect(provider.calls).toHaveLength(0);
  });

  it("uses reviewed generic archetypes for missing internal cards when the case is specific", async () => {
    const caseKey = cards.add(caseFixture.id);
    const gpuGeneric = cards.addGeneric("gpu-2fan-slim");
    const ramGeneric = cards.addGeneric("ram-2-plain");
    const b = await bodyOf(await post(GOOD));

    expect(b.mode).toBe("composed");
    expect(b.renderId).toBe(await composedHash([caseKey, gpuGeneric, ramGeneric]));
    expect(provider.composeCalls[0].images).toBe(3);
    expect(b.promptUsed).toContain("image 1 is the case, image 2 is a generic archetype for the graphics card, image 3 is a generic archetype for the memory modules");
    expect(b.promptUsed).toContain("broad physical form");
  });

  it("never substitutes a generic case card for the build's defining silhouette", async () => {
    cards.addGeneric("case-mid-mesh-window");
    cards.add(gpuFixture.id);
    cards.add(ramFixture.id);
    expect((await bodyOf(await post(GOOD))).mode).toBe("text");
    expect(provider.composeCalls).toHaveLength(0);
  });

  it("falls back when the case itself has no card, and when no cards are configured at all", async () => {
    cards.add(gpuFixture.id);
    cards.add(ramFixture.id);
    expect((await bodyOf(await post(GOOD))).mode).toBe("text");

    ctx.cards = null;
    expect((await bodyOf(await post({ ...GOOD, angle: "side" }))).mode).toBe("text");
    expect(provider.composeCalls).toHaveLength(0);
  });

  it("falls back (and uses the text hash) when an indexed card object is missing from R2", async () => {
    const keys = publishAll();
    cards.objects.delete(keys[1]);
    const b = await bodyOf(await post(GOOD));
    expect(b.mode).toBe("text");
    expect(b.renderId).toBe(await textHash());
    expect(store.objects.get(b.renderId)!.meta.mode).toBe("text");
  });

  it("the cache key separates modes and changes when a card is republished", async () => {
    const keys = publishAll();
    const composed = await composedHash(keys);
    expect(composed).not.toBe(await textHash());

    // Republishing the case card (new content → new content-addressed key) invalidates it.
    cards.add(caseFixture.id, { sha: "b".repeat(64) });
    const next = await composedHash([cards.entries[caseFixture.id].key, keys[1], keys[2]]);
    expect(next).not.toBe(composed);
    const b = await bodyOf(await post(GOOD));
    expect(b.renderId).toBe(next);
    expect(b.cached).toBe(false);
  });

  it("a composed cache hit skips the provider and the quota", async () => {
    publishAll();
    const first = await bodyOf(await post(GOOD));
    expect(first.cached).toBe(false);
    const q = ctx.quota as ReturnType<typeof memoryQuota>;
    expect(await q.status("device-render")).toMatchObject({ userRemaining: 9, globalRemaining: 1 });

    const hit = await bodyOf(await post(GOOD));
    expect(hit).toMatchObject({ cached: true, mode: "composed", renderId: first.renderId });
    expect(hit.promptUsed).toBeUndefined();
    expect(provider.composeCalls).toHaveLength(1);
    expect(await q.status("device-render")).toMatchObject({ userRemaining: 9, globalRemaining: 1 });
  });

  it("forged bodies are still rejected before any card is read", async () => {
    publishAll();
    const forged = await post({ ...GOOD, prompt: "a dragon", cardKeys: ["cards/x/y.png"], images: ["https://evil/x.png"] });
    expect(forged.status).toBe(400);
    expect((await bodyOf(forged)).error.code).toBe("INVALID_INPUT");
    expect(provider.calls).toHaveLength(0);
    expect(provider.composeCalls).toHaveLength(0);
  });
});

describe("GET /api/render/:hash.webp", () => {
  it("serves stored bytes with immutable cache headers; 404 envelope otherwise", async () => {
    const hash = "a".repeat(64);
    await store.put(hash, WEBP_MAGIC, "image/webp", { buildHash: hash, createdAt: T0, style: "studio", angle: "side", mode: "text" });
    const res = await handleRenderGet(hash, store);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toBe(`"${hash}"`);
    expect(res.headers.get("content-length")).toBe(String(WEBP_MAGIC.byteLength));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(WEBP_MAGIC);

    const miss = await handleRenderGet("b".repeat(64), store).catch(toResponse);
    expect(miss.status).toBe(404);
    expect((await bodyOf(miss))).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect((await handleRenderGet("not-a-hash", store).catch(toResponse)).status).toBe(404);
    expect((await handleRenderGet(hash, null).catch(toResponse)).status).toBe(503);
  });
});
