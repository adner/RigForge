/**
 * GET /api/catalog — published parts + catalogVersion + snapshotDate (DESIGN.md §6.1).
 * Strong ETag `"v<version>"`; If-None-Match → 304; 60 s public cache with SWR.
 * If D1 has no published version yet (migrated but not imported), the bundled seed
 * is served with `x-rigbuilder-catalog-source: seed` so the page still works.
 */
import { catalogSchema, type Catalog } from "../src/data/schema";
import { SEED_CATALOG } from "../src/data/seed";
import { ApiError, json } from "./http";
import type { CatalogRepo } from "./repo";

export interface CatalogOptions {
  /** Re-validate every part with the zod schema on the way out. Dev only (perf). */
  validate?: boolean;
}

export const CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=600";

export const etagFor = (version: number, source: "d1" | "seed" = "d1"): string =>
  source === "seed" ? `"seed-v${version}"` : `"v${version}"`;

/** Simple If-None-Match matcher: handles lists and weak validators. */
const etagMatches = (header: string | null, etag: string): boolean => {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .includes(etag);
};

export async function buildCatalog(repo: CatalogRepo, opts: CatalogOptions = {}): Promise<{ catalog: Catalog; source: "d1" | "seed" }> {
  const version = await repo.currentVersion();
  if (!version) return { catalog: SEED_CATALOG, source: "seed" };
  const parts = await repo.listParts({ status: "published" });
  const catalog: Catalog = { catalogVersion: version.version, snapshotDate: version.snapshotDate, parts };
  if (opts.validate) {
    const res = catalogSchema.safeParse(catalog);
    if (!res.success) throw new ApiError(500, "CATALOG_INVALID", "Stored catalog fails schema validation", res.error.issues.slice(0, 10));
  }
  return { catalog, source: "d1" };
}

export async function handleCatalogGet(request: Request, repo: CatalogRepo, opts: CatalogOptions = {}): Promise<Response> {
  const { catalog, source } = await buildCatalog(repo, opts);
  const etag = etagFor(catalog.catalogVersion, source);
  const headers: Record<string, string> = {
    etag,
    "cache-control": CACHE_CONTROL,
    vary: "Accept-Encoding",
    "x-rigbuilder-catalog-source": source,
    "x-rigbuilder-catalog-version": String(catalog.catalogVersion),
  };
  if (etagMatches(request.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  return json(catalog, { headers });
}
