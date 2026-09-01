/**
 * Browser-side catalog loader (DESIGN.md §3, §6.1).
 *
 *   loadCatalog() → { catalog, source: "network" | "cache" | "seed" }
 *
 * Fetches /api/catalog with If-None-Match from the localStorage cache, validates the
 * response with catalogSchema, caches it (quota errors are swallowed), and falls back
 * to the cached copy, then to the bundled SEED_CATALOG when the backend is down.
 * Also a tiny subscription helper so the store can react to catalog changes without
 * depending on React.
 */
import { catalogSchema, type Catalog } from "../data/schema";
import { SEED_CATALOG } from "../data/seed";

export type CatalogSource = "network" | "cache" | "seed";

export interface CatalogState {
  catalog: Catalog;
  source: CatalogSource;
  catalogVersion: number;
  /** True while the first load is in flight. */
  loading: boolean;
}

interface CacheEntry {
  etag: string | null;
  catalog: Catalog;
  savedAt: string;
}

export const CACHE_KEY = "rigbuilder.catalog.v1";
export const LEGACY_CACHE_KEY = "rigforge.catalog.v1";
export const CATALOG_URL = "/api/catalog";

// ---------- tiny emitter ----------

type Listener = (state: CatalogState) => void;
const listeners = new Set<Listener>();

let state: CatalogState = { catalog: SEED_CATALOG, source: "seed", catalogVersion: SEED_CATALOG.catalogVersion, loading: false };

const setState = (next: Partial<CatalogState>): void => {
  state = { ...state, ...next };
  for (const l of listeners) l(state);
};

/** Current catalog state (seed until loadCatalog() resolves). */
export const getCatalogState = (): CatalogState => state;

/** Subscribe to catalog changes; returns an unsubscribe function. */
export const subscribeCatalog = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The version the page is currently working with — included in get_build_state. */
export const catalogVersion = (): number => state.catalogVersion;

// ---------- cache ----------

const storage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export const readCache = (): CacheEntry | null => {
  const s = storage();
  if (!s) return null;
  try {
    const current = s.getItem(CACHE_KEY);
    const raw = current ?? s.getItem(LEGACY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    const res = catalogSchema.safeParse(parsed.catalog);
    if (!res.success) return null;
    if (current === null) {
      s.setItem(CACHE_KEY, raw);
      s.removeItem(LEGACY_CACHE_KEY);
    }
    return { ...parsed, catalog: res.data };
  } catch {
    return null;
  }
};

export const writeCache = (entry: CacheEntry): void => {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // QuotaExceededError or private mode — the network/seed path still works.
  }
};

export const clearCache = (): void => {
  try {
    const s = storage();
    s?.removeItem(CACHE_KEY);
    s?.removeItem(LEGACY_CACHE_KEY);
  } catch {
    /* ignore */
  }
};

// ---------- loader ----------

export interface LoadOptions {
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

export async function loadCatalog(opts: LoadOptions = {}): Promise<{ catalog: Catalog; source: CatalogSource }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const cached = readCache();
  setState({ loading: true });

  const finish = (catalog: Catalog, source: CatalogSource) => {
    setState({ catalog, source, catalogVersion: catalog.catalogVersion, loading: false });
    return { catalog, source };
  };

  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (cached?.etag) headers["if-none-match"] = cached.etag;
    const res = await fetchFn(CATALOG_URL, { headers, signal: opts.signal });

    if (res.status === 304 && cached) return finish(cached.catalog, "cache");
    if (!res.ok) throw new Error(`catalog ${res.status}`);

    const parsed = catalogSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error("catalog failed schema validation");
    writeCache({ etag: res.headers.get("etag"), catalog: parsed.data, savedAt: new Date().toISOString() });
    return finish(parsed.data, "network");
  } catch {
    if (cached) return finish(cached.catalog, "cache");
    return finish(SEED_CATALOG, "seed");
  }
}
