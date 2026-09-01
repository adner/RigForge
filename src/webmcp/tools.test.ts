import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as F from "../engine/__fixtures__/parts";
import { useStore } from "../store";
import { parseEnvelope, type Envelope, type OkEnvelope } from "./envelope";
import { getLastSeenRevision, initLastSeen } from "./lastSeen";
import { executeShopperTool } from "./tools";
import type { ToolName } from "./descriptions";

const st = () => useStore.getState();
const call = async <T = Record<string, unknown>>(name: ToolName, input: unknown = {}, signal?: AbortSignal) => parseEnvelope<T>(await executeShopperTool(name, input, signal));
const okData = <T = Record<string, unknown>>(env: Envelope<T>): T => {
  if (!env.ok) throw new Error(`expected ok, got ${env.error.code}: ${env.error.message}`);
  return env.data;
};
const seedGood = () => {
  for (const p of F.GOOD_PARTS) st().addPart(p.id, {}, "agent");
};

beforeEach(() => {
  st().resetAll();
  st().setCatalog(F.CATALOG, { catalogVersion: 7, source: "seed", snapshotDate: "2026-08-29" });
  initLastSeen(st().buildRevision);
});
afterEach(() => vi.restoreAllMocks());

describe("envelope", () => {
  it("every response carries ok, buildRevision, summary and the slim digest", async () => {
    seedGood();
    const env = await call("get_build_state");
    expect(env.ok).toBe(true);
    expect(env.buildRevision).toBe(8);
    expect(typeof env.summary).toBe("string");
    expect(env.digest).toMatchObject({ totalUSD: 2162, estWatts: 659, validation: { errors: 0, warnings: 0, info: 0 } });
    expect(env.digest.slots.cpu).toBe(F.cpu9800x3d.id);
    expect(env.digest.slots.ram).toEqual([F.ramDdr5_6000_2x16.id]);
    expect(Object.keys(env.digest.slots)).toHaveLength(8);
    const bad = await call("get_part_details", { partId: "cpu-ghost" });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error();
    expect(bad.error.code).toBe("UNKNOWN_PART");
    expect(bad.digest.slots.cpu).toBe(F.cpu9800x3d.id);
    expect(bad.buildRevision).toBe(8);
  });

  it("unknown fields and bad enums → INVALID_INPUT", async () => {
    const a = await call("search_parts", { category: "cpu", bogus: 1 });
    expect(a).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    const b = await call("estimate_performance", { workload: "mining" });
    expect(b).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    const c = await call("reset_build", { confirm: false });
    expect(c).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("an already-aborted signal → CANCELLED", async () => {
    const ac = new AbortController();
    ac.abort();
    expect(await call("get_build_state", {}, ac.signal)).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  });

  it("hides state-sync chatter and describes visible agent work without raw tool arguments", async () => {
    await call("get_build_state");
    expect(st().feed).toHaveLength(0);
    await call("search_parts", { category: "gpu", maxPrice: 1000 });
    expect(st().feed.at(-1)).toMatchObject({
      actor: "agent",
      kind: "tool",
      toolName: "search_parts",
      title: "🤖 Searched the catalog for GPU options",
    });
    expect(st().feed.at(-1)?.detail).toBeUndefined();
    const before = st().feed.length;
    await call("add_part", { partId: F.cpu9800x3d.id });
    expect(st().feed.length).toBe(before + 1);
    expect(st().feed.at(-1)).toMatchObject({ kind: "tool", toolName: "add_part", undo: "available" });
    await call("add_part", { partId: F.cpu9600x.id });
    expect(st().feed.at(-1)).toMatchObject({
      title: "🤖 Tried to add the requested part to the build",
      resultSummary: "That slot already has a part, so nothing was changed.",
    });
    expect(st().feed.at(-1)?.resultSummary).not.toContain(F.cpu9800x3d.id);
  });
});

describe("stale-write guard (§4.5)", () => {
  it("human edit between two agent calls → STALE_REVISION with no expectedRevision, nothing mutated", async () => {
    await call("add_part", { partId: F.cpu9800x3d.id }); // agent, rev 1 → lastSeen 1
    expect(getLastSeenRevision()).toBe(1);
    st().addPart(F.mbX870eAtx.id, {}, "human"); // rev 2, agent has not seen it
    const env = await call("add_part", { partId: F.gpu5070ti.id });
    expect(env).toMatchObject({ ok: false, buildRevision: 2, error: { code: "STALE_REVISION", details: { expected: 1, current: 2 } } });
    expect(st().build.slots.gpu).toBeUndefined();
    expect(st().buildRevision).toBe(2);
    // The failed response re-synced the agent: the next write succeeds.
    expect(getLastSeenRevision()).toBe(2);
    expect((await call("add_part", { partId: F.gpu5070ti.id })).ok).toBe(true);
  });

  it("explicit expectedRevision is honoured over lastSeen", async () => {
    await call("add_part", { partId: F.cpu9800x3d.id }); // rev 1
    const stale = await call("add_part", { partId: F.mbX870eAtx.id, expectedRevision: 0 });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_REVISION", details: { expected: 0, current: 1 } } });
    const fresh = await call("add_part", { partId: F.mbX870eAtx.id, expectedRevision: 1 });
    expect(fresh.ok).toBe(true);
    expect(fresh.buildRevision).toBe(2);
  });

  it("chains: successive writes advance lastSeen automatically", async () => {
    for (const p of F.GOOD_PARTS) {
      const env = await call("add_part", { partId: p.id });
      expect(env.ok).toBe(true);
    }
    expect(st().buildRevision).toBe(8);
    expect(getLastSeenRevision()).toBe(8);
    expect((await call("remove_part", { category: "storage" })).ok).toBe(true);
    expect((await call("set_build_goal", { useCase: "gaming", budgetUSD: 3000 })).ok).toBe(true);
    expect((await call("reset_build", { confirm: true })).ok).toBe(true);
    expect(st().buildRevision).toBe(11);
  });

  it("any read re-syncs the agent after a human edit", async () => {
    st().addPart(F.cpu9800x3d.id, {}, "human");
    await call("search_parts", { category: "motherboard" });
    expect((await call("add_part", { partId: F.mbX870eAtx.id })).ok).toBe(true);
  });
});

describe("read tools", () => {
  it("get_build_state: slots with specs, conflicts, goal, active render, catalogVersion", async () => {
    seedGood();
    st().setGoal({ useCase: "gaming", budgetUSD: 2000 }, "human");
    st().addRender({ renderId: "r1", forBuildRevision: 8, buildHash: "h", imageUrl: "/api/render/h.webp", status: "active", style: "photoreal", angle: "front", createdAt: "x" });
    const d = okData<{ slots: Record<string, unknown>; conflicts: { code: string }[]; catalogVersion: number; activeRender: { renderId: string }; goal: { budgetUSD: number }; psuHeadroomPct: number }>(await call("get_build_state"));
    expect((d.slots.cpu as { specs: Record<string, unknown> }).specs).toMatchObject({ socket: "AM5", cores: 8 });
    expect(Array.isArray(d.slots.storage)).toBe(true);
    expect(d.conflicts.map((c) => c.code)).toEqual(["OVER_BUDGET"]);
    expect(d.catalogVersion).toBe(7);
    expect(d.activeRender.renderId).toBe("r1");
    expect(d.goal.budgetUSD).toBe(2000);
    expect(d.psuHeadroomPct).toBe(34.1);
  });

  it("search_parts: tri-state fit + pending, hides incompatible by default when build non-empty, paginates", async () => {
    const empty = okData<{ parts: { fit: string; pending: string[]; specs: Record<string, unknown> }[]; total: number; filtered: boolean }>(await call("search_parts", { category: "gpu" }));
    expect(empty.filtered).toBe(false);
    expect(empty.total).toBe(8);
    expect(empty.parts.every((p) => p.fit === "conditional" && p.pending.includes("GPU_TOO_LONG"))).toBe(true);
    expect(empty.parts.every((p) => Object.keys(p.specs).length <= 5)).toBe(true);

    st().addPart(F.caseItx15l.id, {}, "human"); // max GPU 330 mm
    const filtered = okData<{ parts: { id: string; fit: string }[]; total: number; hidden: number }>(await call("search_parts", { category: "gpu" }));
    expect(filtered.parts.map((p) => p.id)).not.toContain(F.gpu5090.id);
    expect(filtered.hidden).toBe(1);

    const all = okData<{ parts: { id: string; fit: string }[]; total: number }>(await call("search_parts", { category: "gpu", compatibleWithCurrentBuild: false, sortBy: "performance" }));
    expect(all.total).toBe(8);
    expect(all.parts[0]!.id).toBe(F.gpu5090.id);
    expect(all.parts[0]!.fit).toBe("incompatible");

    const page = okData<{ parts: unknown[]; total: number; offset: number }>(await call("search_parts", { category: "gpu", compatibleWithCurrentBuild: false, limit: 3, offset: 6 }));
    expect(page.parts).toHaveLength(2);
    expect(page.total).toBe(8);
  });

  it("search_parts: query, price range and typed filters (exact, min/max, arrays); bad filter → INVALID_INPUT", async () => {
    const q = okData<{ parts: { id: string }[] }>(await call("search_parts", { category: "cpu", query: "intel" }));
    expect(q.parts.map((p) => p.id).sort()).toEqual([F.cpu14600k.id, F.cpu265k.id].sort());
    const f = okData<{ parts: { id: string }[] }>(await call("search_parts", { category: "gpu", filters: { minVramGB: 16, maxLengthMm: 310 }, maxPrice: 1000 }));
    expect(f.parts.map((p) => p.id).sort()).toEqual([F.gpu5070ti.id, F.gpu5080.id].sort());
    const c = okData<{ parts: { id: string }[] }>(await call("search_parts", { category: "case", filters: { formFactor: "E-ATX" } }));
    expect(c.parts.map((p) => p.id)).toEqual([F.caseFullTower60l.id]);
    const cooler = okData<{ parts: { id: string }[] }>(await call("search_parts", { category: "cooler", filters: { type: "aio", maxRadiatorMm: 240 } }));
    expect(cooler.parts.map((p) => p.id)).toEqual([F.coolerAio240.id]);
    expect(await call("search_parts", { category: "cpu", filters: { vramGB: 8 } })).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("get_part_details returns the full sheet, sourceUrl only when verified, inBuild", async () => {
    st().addPart(F.cpu9800x3d.id, {}, "human");
    const d = okData<Record<string, unknown>>(await call("get_part_details", { partId: F.cpu9800x3d.id }));
    expect(d).toMatchObject({ id: F.cpu9800x3d.id, perfTier: expect.any(Object), sourceUrl: "https://example.com/spec", inBuild: true, verified: true });
    expect(d).not.toHaveProperty("sources");
    const u = okData<Record<string, unknown>>(await call("get_part_details", { partId: F.cpu2600.id }));
    expect(u.sourceUrl).toBeNull();
    expect(u.inBuild).toBe(false);
  });

  it("validate_build: current build, hypothetical ops on a copy, SLOT_OCCUPIED for add on occupied slot", async () => {
    seedGood();
    const cur = okData<{ conflicts: unknown[]; hypothetical: boolean }>(await call("validate_build"));
    expect(cur).toMatchObject({ hypothetical: false, conflicts: [] });
    const hyp = okData<{ conflicts: { code: string }[]; slots: Record<string, string[]>; hypothetical: boolean }>(
      await call("validate_build", { hypothetical: [{ op: "replace", partId: F.caseItx15l.id }, { op: "remove", partId: F.coolerAir165.id }] }),
    );
    expect(hyp.hypothetical).toBe(true);
    expect(hyp.conflicts.map((c) => c.code)).toEqual(expect.arrayContaining(["FORM_FACTOR_MISMATCH", "COOLER_MISSING"]));
    expect(hyp.slots.case).toEqual([F.caseItx15l.id]);
    expect(st().build.slots.case![0]!.id).toBe(F.caseMidAtxBlack.id); // untouched
    expect(st().buildRevision).toBe(8);
    expect(await call("validate_build", { hypothetical: [{ op: "add", partId: F.cpu9600x.id }] })).toMatchObject({ ok: false, error: { code: "SLOT_OCCUPIED" } });
    expect(await call("validate_build", { hypothetical: [{ op: "add", partId: "gpu-nope" }] })).toMatchObject({ ok: false, error: { code: "UNKNOWN_PART" } });
  });

  it("explain_compatibility: per-rule states and overall fit", async () => {
    st().addPart(F.caseItx15l.id, {}, "human");
    const d = okData<{ fit: string; pending: string[]; rules: { code: string; result: string; reason: string }[] }>(await call("explain_compatibility", { partId: F.gpu5090.id }));
    expect(d.fit).toBe("incompatible");
    const len = d.rules.find((r) => r.code === "GPU_TOO_LONG")!;
    expect(len.result).toBe("fail");
    expect(len.reason).toMatch(/358 mm, case max 330 mm/);
    expect(d.rules.find((r) => r.code === "PSU_INSUFFICIENT")!.result).toBe("unknown");
    expect(d.pending).toContain("PSU_INSUFFICIENT");
    expect(d.rules.find((r) => r.code === "GOAL_NOISE")?.result ?? "not_applicable").toBe("not_applicable");
  });

  it("estimate_performance: editorial summary + bottleneck", async () => {
    seedGood();
    const env = await call<{ overallTier: number; bottleneck: { category: string }; editorial: boolean }>(await Promise.resolve("estimate_performance"), { workload: "gaming", resolution: "4k" });
    const d = okData(env);
    expect(env.summary).toMatch(/editorial tier estimate/);
    expect(d.editorial).toBe(true);
    expect(d.overallTier).toBe(8);
    expect(d.bottleneck.category).toBe("gpu");
  });
});

describe("write tools", () => {
  it("add_part: ok with delta; SLOT_OCCUPIED; replace; UNKNOWN_PART", async () => {
    await call("add_part", { partId: F.cpu265k.id });
    const env = await call("add_part", { partId: F.mbB650Atx.id });
    expect(env).toMatchObject({ ok: true, buildRevision: 2, delta: { added: ["SOCKET_MISMATCH"], removed: [] } });
    expect(await call("add_part", { partId: F.mbX870eAtx.id })).toMatchObject({ ok: false, error: { code: "SLOT_OCCUPIED" } });
    expect(await call("add_part", { partId: "mb-nope" })).toMatchObject({ ok: false, error: { code: "UNKNOWN_PART" } });
    const rep = await call("add_part", { partId: F.mbZ890Atx.id, replace: true });
    expect(rep).toMatchObject({ ok: true, buildRevision: 3, delta: { added: [], removed: ["SOCKET_MISMATCH"] } });
  });

  it("remove_part: by partId or category; exactly one required", async () => {
    seedGood();
    initLastSeen(st().buildRevision);
    expect(await call("remove_part", {})).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(await call("remove_part", { partId: F.gpu5070ti.id, category: "gpu" })).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    const r = await call("remove_part", { partId: F.coolerAir165.id });
    expect(r).toMatchObject({ ok: true, delta: { added: ["COOLER_MISSING"] } });
    expect((await call("remove_part", { category: "ram" })).ok).toBe(true);
    expect(st().build.slots.ram).toBeUndefined();
  });

  it("set_build_goal: enums only, goal-aware validation; reset_build needs confirm", async () => {
    seedGood();
    initLastSeen(st().buildRevision);
    expect(await call("set_build_goal", { useCase: "gaming", budgetUSD: 1500, preferences: { noise: "silent" } })).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    const g = await call("set_build_goal", { useCase: "gaming", budgetUSD: 1500, preferences: { noise: "quiet" } });
    expect(g).toMatchObject({ ok: true, buildRevision: 9, delta: { added: ["OVER_BUDGET"] } });
    const reset = await call("reset_build", { confirm: true });
    expect(reset).toMatchObject({ ok: true, buildRevision: 10 });
    expect(reset.digest.slots.cpu).toBeNull();
  });
});

describe("solver & output tools", () => {
  it("suggest_alternatives: candidates with deltas; DIRECTION_NOT_APPLICABLE; works on empty slot", async () => {
    seedGood();
    const d = okData<{ current: string; candidates: { partId: string; priceDelta: number; validation: { added: string[] }; tradeoff: string; verified: boolean }[] }>(
      await call("suggest_alternatives", { category: "gpu", direction: "cheaper", count: 3 }),
    );
    expect(d.current).toBe(F.gpu5070ti.id);
    expect(d.candidates.length).toBeGreaterThan(0);
    expect(d.candidates.length).toBeLessThanOrEqual(3);
    expect(d.candidates.every((c) => c.priceDelta < 0 && c.tradeoff.length > 0 && typeof c.verified === "boolean")).toBe(true);
    const na = await call("suggest_alternatives", { category: "cpu", direction: "quieter" });
    expect(na).toMatchObject({ ok: false, error: { code: "DIRECTION_NOT_APPLICABLE", details: { applicable: ["cheaper", "better"] } } });
    st().resetAll();
    const empty = okData<{ current: null; candidates: unknown[] }>(await call("suggest_alternatives", { category: "cpu" }));
    expect(empty.current).toBeNull();
    expect(empty.candidates.length).toBeGreaterThan(0);
  });

  it("fit_to_budget: proposal with forBuildRevision, not applied; BUDGET_INFEASIBLE", async () => {
    seedGood();
    const d = okData<{ proposalId: string; forBuildRevision: number; ops: { op: string; toPartId: string }[]; totalUSD: number }>(await call("fit_to_budget", { budgetUSD: 1900 }));
    expect(d.forBuildRevision).toBe(8);
    expect(d.proposalId).toMatch(/^p_/);
    expect(d.ops.length).toBeGreaterThan(0);
    expect(d.totalUSD).toBeLessThanOrEqual(1900);
    expect(st().buildRevision).toBe(8);
    const inf = await call("fit_to_budget", { budgetUSD: 300, protect: ["gpu", "cpu"] });
    expect(inf).toMatchObject({ ok: false, error: { code: "BUDGET_INFEASIBLE" } });
    if (inf.ok) throw new Error();
    expect(inf.error.details).toMatchObject({ blockedBy: expect.arrayContaining(["gpu"]) });
    expect(typeof (inf.error.details as { cheapestTotal: number }).cheapestTotal).toBe("number");
  });

  it("export_build: markdown, json, url (short+fragment) and url fallback (fragment)", async () => {
    seedGood();
    st().setGoal({ useCase: "gaming", budgetUSD: 2500 }, "human");
    const md = okData<{ markdown: string }>(await call("export_build", { format: "markdown" }));
    expect(md.markdown).toMatch(/# RigBuilder build/);
    expect(md.markdown).toMatch(/\$2162/);
    const json = okData<{ v: number; parts: string[]; goal: { useCase: string } }>(await call("export_build", { format: "json" }));
    expect(json).toMatchObject({ v: 1, goal: { useCase: "gaming" } });
    expect(json.parts).toHaveLength(8);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "abc123" }), { status: 200 }));
    const url = okData<{ url: string; transport: string; id: string }>(await call("export_build", { format: "url" }));
    expect(url.transport).toBe("short+fragment");
    expect(url.url).toMatch(/\/b\/abc123#b=/);
    expect(fetchMock).toHaveBeenCalledWith("/api/builds", expect.objectContaining({ method: "POST", credentials: "same-origin" }));

    fetchMock.mockRejectedValue(new Error("offline"));
    const fb = okData<{ url: string; transport: string }>(await call("export_build", { format: "url" }));
    expect(fb.transport).toBe("fragment");
    expect(fb.url).toMatch(/^\/?#b=|\/#b=/);
  });
});

describe("render_build", () => {
  const renderOk = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("requires a case", async () => {
    st().addPart(F.cpu9800x3d.id, {}, "human");
    expect(await call("render_build")).toMatchObject({ ok: false, error: { code: "RENDER_NEEDS_CASE" } });
  });

  it("creates a pending artifact, resolves active when the hash still matches, never bumps buildRevision", async () => {
    seedGood();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      expect(st().renders.at(-1)?.status).toBe("pending");
      return renderOk({ imageUrl: "/api/render/abc.webp", cached: true });
    });
    const flair = "a small illustrated turtle sticker on the glass side panel";
    const env = await call<{ renderId: string; status: string; imageUrl: string; cached: boolean; forBuildRevision: number; buildHash: string; flair: string }>("render_build", {
      style: "studio",
      angle: "side",
      flair,
    });
    const d = okData(env);
    expect(d).toMatchObject({ status: "active", imageUrl: "/api/render/abc.webp", cached: true, forBuildRevision: 8, flair });
    expect(d.buildHash).toMatch(/^[0-9a-f]{64}$/);
    expect(env.buildRevision).toBe(8);
    expect(st().buildRevision).toBe(8);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ v: 1, style: "studio", angle: "side" });
    expect(body.flair).toBe(flair);
    expect(body.partIds).toHaveLength(8);
    expect(body).not.toHaveProperty("prompt");
    // Same build again → returns the existing active render without a fetch.
    fetchMock.mockClear();
    const again = okData<{ renderId: string; cached: boolean }>(await call("render_build", { style: "studio", angle: "side", flair }));
    expect(again.renderId).toBe(d.renderId);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("build changed mid-render → superseded", async () => {
    seedGood();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      st().addPart(F.caseFullTower60l.id, { replace: true }, "human");
      return renderOk({ imageUrl: "/api/render/old.webp" });
    });
    const d = okData<{ status: string }>(await call("render_build"));
    expect(d.status).toBe("superseded");
    expect(st().renders.at(-1)!.status).toBe("superseded");
  });

  it("maps 403/429/503/504 and network failure to the envelope codes", async () => {
    seedGood();
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(renderOk({ code: "VERIFICATION_REQUIRED" }, 403));
    expect(await call("render_build")).toMatchObject({ ok: false, error: { code: "VERIFICATION_REQUIRED" } });
    spy.mockResolvedValueOnce(renderOk({ code: "RENDER_RATE_LIMITED", retryAfterSec: 42 }, 429));
    expect(await call("render_build")).toMatchObject({ ok: false, error: { code: "RENDER_RATE_LIMITED", details: { retryAfterSec: 42 } } });
    spy.mockResolvedValueOnce(renderOk({}, 503));
    expect(await call("render_build")).toMatchObject({ ok: false, error: { code: "RENDER_UNAVAILABLE" } });
    spy.mockResolvedValueOnce(renderOk({}, 504));
    expect(await call("render_build")).toMatchObject({ ok: false, error: { code: "RENDER_FAILED" } });
    spy.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await call("render_build")).toMatchObject({ ok: false, error: { code: "RENDER_UNAVAILABLE" } });
    expect(st().renders.every((r) => r.status === "failed")).toBe(true);
    expect(st().buildRevision).toBe(8);
  });

  it("aborting the signal cancels the fetch → CANCELLED", async () => {
    seedGood();
    const ac = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation((_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    const p = call("render_build", {}, ac.signal);
    ac.abort();
    expect(await p).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  });
});

// Keep the OkEnvelope type referenced so the import is not flagged as unused by tsc.
void (null as unknown as OkEnvelope | null);
