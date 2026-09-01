import { describe, expect, it } from "vitest";
import { SEED_CATALOG } from "../src/data/seed";
import { handleCatalogGet } from "./catalog";
import { cpuFixture, gpuFixture, T0 } from "./fixtures";
import { memoryRepo } from "./repo-memory";

const version = { version: 3, publishedAt: T0, snapshotDate: "2026-08-29", summary: "test" };

describe("GET /api/catalog", () => {
  it("returns published parts, version, snapshot and a strong ETag", async () => {
    const repo = memoryRepo([cpuFixture, gpuFixture, { ...gpuFixture, id: "gpu-draft", status: "draft" }], version);
    const res = await handleCatalogGet(new Request("http://x/api/catalog"), repo, { validate: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('"v3"');
    expect(res.headers.get("cache-control")).toContain("max-age=60");
    expect(res.headers.get("cache-control")).toContain("stale-while-revalidate");
    const body = (await res.json()) as { catalogVersion: number; snapshotDate: string; parts: Array<{ id: string }> };
    expect(body.catalogVersion).toBe(3);
    expect(body.snapshotDate).toBe("2026-08-29");
    expect(body.parts.map((p) => p.id).sort()).toEqual(["cpu-test-7600", "gpu-test-5060"]);
  });

  it("answers 304 to a matching If-None-Match (also weak / list forms)", async () => {
    const repo = memoryRepo([cpuFixture], version);
    for (const inm of ['"v3"', 'W/"v3"', '"v1", "v3"']) {
      const res = await handleCatalogGet(new Request("http://x/api/catalog", { headers: { "if-none-match": inm } }), repo);
      expect(res.status).toBe(304);
      expect(res.headers.get("etag")).toBe('"v3"');
    }
    const miss = await handleCatalogGet(new Request("http://x/api/catalog", { headers: { "if-none-match": '"v2"' } }), repo);
    expect(miss.status).toBe(200);
  });

  it("serves the bundled seed when D1 has no published version", async () => {
    const res = await handleCatalogGet(new Request("http://x/api/catalog"), memoryRepo());
    expect(res.status).toBe(200);
    expect(res.headers.get("x-rigbuilder-catalog-source")).toBe("seed");
    expect(res.headers.get("etag")).toBe(`"seed-v${SEED_CATALOG.catalogVersion}"`);
  });

  it("dev validation reports a corrupted row as 500 CATALOG_INVALID", async () => {
    const repo = memoryRepo([{ ...cpuFixture, cores: 999 } as typeof cpuFixture], version);
    await expect(handleCatalogGet(new Request("http://x/api/catalog"), repo, { validate: true })).rejects.toMatchObject({
      status: 500,
      code: "CATALOG_INVALID",
    });
    // …and is served as-is in prod (no per-request validation).
    expect((await handleCatalogGet(new Request("http://x/api/catalog"), repo)).status).toBe(200);
  });
});
