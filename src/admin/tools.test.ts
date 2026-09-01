import { describe, expect, it, vi } from "vitest";
import type { AdminApi } from "./api";
import { ADMIN_TOOLS } from "./descriptions";
import { createAdminHandlers } from "./tools";
import { validateUpsertInput } from "./validate";

const perf = { gaming1080p: 7, gaming1440p: 6, gaming4k: 5, streaming: 6, videoEditing: 5, rendering3d: 5, ml: 4, office: 8 };
const gpu = {
  name: "Test 5060 Ti 16GB",
  brand: "Testbrand",
  category: "gpu",
  priceUSD: 429,
  lengthMm: 250,
  slots: 2,
  tdpW: 180,
  pcieGen: 5,
  recommendedPsuW: 600,
  vramGB: 16,
  noiseTier: 2,
  perfTier: perf,
};
const sources = [{ url: "https://example.com/spec/5060ti" }];

const mockApi = (): AdminApi & { calls: string[] } => {
  const calls: string[] = [];
  const rec =
    <T,>(name: string, value: T) =>
    async () => {
      calls.push(name);
      return value;
    };
  return {
    calls,
    getSession: rec("getSession", { identity: "test@example.com", accountable: true, role: "owner" as const }),
    listParts: rec("listParts", { count: 1, parts: [{ id: "gpu-x", name: "X", brand: "B", category: "gpu" as const, priceUSD: 1, verified: false, status: "draft" as const, addedBy: "agent" as const, updatedAt: "t" }] }),
    listPartsFull: rec("listPartsFull", { count: 0, parts: [] }),
    getPart: rec("getPart", { partId: "gpu-x", published: null, draft: null, diff: [] }),
    getSchema: rec("getSchema", { category: "gpu" as const, schema: {}, notes: {} }),
    listChangeLog: rec("listChangeLog", { entries: [], nextBefore: null }),
    getCardAvailability: rec("getCardAvailability", { specificPartIds: [], genericArchetypes: [] }),
    upsertDraft: rec("upsertDraft", { partId: "gpu-testbrand-test-5060-ti-16gb", status: "draft" as const, validation: { ok: true, issues: [] }, diff: [{ field: "*", before: null, after: "new part" }] }),
    updatePrice: rec("updatePrice", { partId: "gpu-x", status: "draft" as const, diff: [] }),
    verifyPart: rec("verifyPart", { partId: "gpu-x", verified: true }),
    discardDraft: rec("discardDraft", { partId: "gpu-x", discarded: true as const }),
    publish: rec("publish", { catalogVersion: 4, published: 1, partIds: ["gpu-x"] }),
  };
};

const handlers = (api = mockApi()) => ({ api, h: createAdminHandlers({ api, log: () => {} }) });

describe("description budgets (DESIGN §4.6)", () => {
  it("has exactly the 5 tools of §4.7", () => {
    expect(ADMIN_TOOLS.map((t) => t.name)).toEqual(["catalog_search", "catalog_get_schema", "catalog_upsert_part", "catalog_update_price", "catalog_publish"]);
  });
  it("keeps every description ≤ 500 chars and every parameter ≤ 150 chars", () => {
    for (const t of ADMIN_TOOLS) {
      expect(t.description.length, t.name).toBeLessThanOrEqual(500);
      const props = (t.inputSchema.properties ?? {}) as Record<string, { description?: string; items?: { properties?: Record<string, { description?: string }> } }>;
      for (const [k, p] of Object.entries(props)) {
        expect(p.description?.length ?? 0, `${t.name}.${k}`).toBeLessThanOrEqual(150);
        for (const [ik, ip] of Object.entries(p.items?.properties ?? {})) expect(ip.description?.length ?? 0, `${t.name}.${k}.${ik}`).toBeLessThanOrEqual(150);
      }
    }
  });
  it("annotates read tools and marks catalog_search as untrusted content", () => {
    const byName = Object.fromEntries(ADMIN_TOOLS.map((t) => [t.name, t.annotations]));
    expect(byName.catalog_search).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    expect(byName.catalog_get_schema.readOnlyHint).toBe(true);
    expect(byName.catalog_upsert_part.readOnlyHint).toBe(false);
    expect(byName.catalog_publish.readOnlyHint).toBe(false);
  });
  it("upsert description states human-only verification and search-first", () => {
    const d = ADMIN_TOOLS.find((t) => t.name === "catalog_upsert_part")!.description;
    expect(d).toMatch(/human-only/i);
    expect(d).toMatch(/catalog_search/);
  });
});

describe("catalog_upsert_part validation", () => {
  it("rejects missing sources with INVALID_INPUT without touching the network", async () => {
    const { api, h } = handlers();
    const res = await h.catalog_upsert_part({ part: gpu });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INVALID_INPUT");
    expect(api.calls).toEqual([]);
  });
  it("rejects http sources", () => {
    const v = validateUpsertInput({ part: gpu, sources: [{ url: "http://example.com" }] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues[0].path).toMatch(/^sources/);
  });
  it("rejects verified:true client-side with VERIFIED_IS_HUMAN_ONLY", async () => {
    const { api, h } = handlers();
    const res = await h.catalog_upsert_part({ part: { ...gpu, verified: true }, sources });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VERIFIED_IS_HUMAN_ONLY");
    expect(api.calls).toEqual([]);
  });
  it("rejects markup / URLs in name", async () => {
    const { h } = handlers();
    const res = await h.catalog_upsert_part({ part: { ...gpu, name: "RTX <b>5060</b>" }, sources });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("INVALID_INPUT");
      expect(JSON.stringify(res.error.details)).toMatch(/part\.name/);
    }
    const res2 = await h.catalog_upsert_part({ part: { ...gpu, name: "see https://x.y" }, sources });
    expect(res2.ok).toBe(false);
  });
  it("reports zod issues per field", () => {
    const v = validateUpsertInput({ part: { ...gpu, lengthMm: 9999, vramGB: undefined }, sources });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const paths = v.issues.map((i) => i.path);
      expect(paths).toContain("part.lengthMm");
      expect(paths).toContain("part.vramGB");
    }
  });
  it("never forwards verified/status/addedBy and sets addedBy agent on the wire", async () => {
    const api = mockApi();
    const spy = vi.spyOn(api, "upsertDraft");
    const { h } = handlers(api);
    const res = await h.catalog_upsert_part({ part: { ...gpu, status: "published", addedBy: "human" }, sources, note: "launch day" });
    expect(res.ok).toBe(true);
    const [part, addedBy, note] = spy.mock.calls[0];
    expect(addedBy).toBe("agent");
    expect(note).toBe("launch day");
    expect(part).not.toHaveProperty("verified");
    expect(part).not.toHaveProperty("status");
    expect(part).not.toHaveProperty("addedBy");
    expect(part.sources).toEqual(sources);
    expect(part.id).toBe("gpu-testbrand-test-5060-ti-16gb");
    if (res.ok) expect(res.data).toMatchObject({ partId: "gpu-testbrand-test-5060-ti-16gb", status: "draft", validation: { ok: true } });
  });
});

describe("catalog_publish", () => {
  it("requires confirm:true", async () => {
    const { api, h } = handlers();
    for (const input of [{}, { confirm: false }, { confirm: "true" }]) {
      const res = await h.catalog_publish(input);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("CONFIRM_REQUIRED");
    }
    expect(api.calls).toEqual([]);
  });
  it("publishes with confirm and reports the new version", async () => {
    const onMutation = vi.fn();
    const api = mockApi();
    const h = createAdminHandlers({ api, log: () => {}, onMutation });
    const res = await h.catalog_publish({ confirm: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toMatchObject({ catalogVersion: 4 });
    expect(onMutation).toHaveBeenCalledTimes(1);
  });
});

describe("other tools", () => {
  it("catalog_update_price validates and calls the API as agent", async () => {
    const api = mockApi();
    const spy = vi.spyOn(api, "updatePrice");
    const h = createAdminHandlers({ api, log: () => {} });
    const bad = await h.catalog_update_price({ partId: "gpu-x", priceUSD: 10, sourceUrl: "http://nope" });
    expect(bad.ok).toBe(false);
    const good = await h.catalog_update_price({ partId: "gpu-x", priceUSD: 10, sourceUrl: "https://shop.example/x" });
    expect(good.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith("gpu-x", 10, "https://shop.example/x", "agent");
  });
  it("catalog_get_schema returns a JSON Schema with id notes", async () => {
    const { h } = handlers();
    const res = await h.catalog_get_schema({ category: "cooler" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const d = res.data as { schema: { properties: Record<string, unknown> }; notes: Record<string, string> };
      expect(d.schema.properties).toHaveProperty("socketSupport");
      expect(d.notes.id).toMatch(/cooler/);
    }
    const bad = await h.catalog_get_schema({ category: "keyboard" });
    expect(bad.ok).toBe(false);
  });
  it("logs a 🤖 row for every call", async () => {
    const log = vi.fn();
    const h = createAdminHandlers({ api: mockApi(), log });
    await h.catalog_search({ query: "x" });
    await h.catalog_publish({});
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toBe("agent");
    expect(log.mock.calls[1][2]).toMatch(/CONFIRM_REQUIRED/);
  });
  it("maps API failures to error envelopes instead of throwing", async () => {
    const api = mockApi();
    api.listParts = async () => {
      throw new Error("boom");
    };
    const h = createAdminHandlers({ api, log: () => {} });
    const res = await h.catalog_search({ query: "x" });
    expect(res).toMatchObject({ ok: false, error: { code: "INTERNAL", message: "boom" } });
  });
});
