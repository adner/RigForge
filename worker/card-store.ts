/**
 * Part-card storage (docs/RENDER_FIDELITY.md Phase 1/2). Cards are reviewed, brand-free studio
 * images of the visually significant parts, generated offline and published with
 * `pnpm cards:publish` into the same R2 bucket as the renders, under the `cards/` prefix:
 *
 *   cards/<partId>/<sha256(png)>.png   card bytes (content-addressed → immutable)
 *   cards/index.json                   { [partId]: { key, mode, promptHash?, reviewedAt } }
 *
 * The Worker reads the index once per isolate (short TTL) and fetches card bytes by key only
 * when a composed render actually needs them. Cards are a server-side input: the client never
 * sends, names or sees a card key (DESIGN §4.3 trust boundary). Memory-backed variant for tests.
 */
import type { Category } from "../src/data/schema";
import { isGenericCardArchetype, type GenericCardArchetype } from "../src/engine/cardArchetype";

/**
 * Categories whose cards a composed render uses, in the order the reference images are sent
 * to the provider. Mirrors CARD_CATEGORIES in src/engine/partCardPrompt.ts (kept separate so
 * the Worker does not depend on the offline card-generation module).
 */
export const CARD_ORDER = ["case", "gpu", "cooler", "ram"] as const satisfies readonly Category[];
export type CardCategory = (typeof CARD_ORDER)[number];

export const CARD_INDEX_KEY = "cards/index.json";
export const GENERIC_CARD_INDEX_KEY = "cards/generic/index.json";
/** Per-isolate index cache lifetime; a freshly published card appears within this window. */
export const CARD_INDEX_TTL_MS = 60 * 1000;

export interface CardIndexEntry {
  /** R2 key, `cards/<partId>/<sha256>.png`. */
  key: string;
  /** How the card was produced: "reference" | "description" | "attributes" (free-form). */
  mode: string;
  promptHash?: string;
  reviewedAt?: string;
  /** Small UI derivative, `cards/<partId>/<same sha>.thumb.webp`. */
  thumbKey?: string;
}
export type CardIndex = Record<string, CardIndexEntry>;
export type GenericCardIndex = Partial<Record<GenericCardArchetype, CardIndexEntry>>;

export interface CardImage {
  bytes: Uint8Array;
  contentType: string;
}

export interface CardStore {
  /** The published card index (cached per isolate). Empty object when there is none. */
  index(): Promise<CardIndex>;
  /** Reviewed generic archetypes (cached separately from the specific-card index). */
  genericIndex(): Promise<GenericCardIndex>;
  /** Card bytes by key, or null when the key is unknown/invalid or the object is gone. */
  get(key: string): Promise<CardImage | null>;
}

export const cardKeyFor = (partId: string, sha256: string): string => `cards/${partId}/${sha256}.png`;
export const cardThumbKeyFor = (partId: string, sha256: string): string => `cards/${partId}/${sha256}.thumb.webp`;
export const genericCardKeyFor = (archetype: GenericCardArchetype, sha256: string): string => `cards/generic/${archetype}/${sha256}.png`;
export const genericCardThumbKeyFor = (archetype: GenericCardArchetype, sha256: string): string => `cards/generic/${archetype}/${sha256}.thumb.webp`;

const CARD_KEY_RE = /^cards\/([a-z0-9-]{1,80})\/[0-9a-f]{64}\.png$/;
const CARD_THUMB_KEY_RE = /^cards\/([a-z0-9-]{1,80})\/[0-9a-f]{64}\.thumb\.webp$/;
const GENERIC_CARD_KEY_RE = /^cards\/generic\/([a-z0-9-]{1,80})\/[0-9a-f]{64}\.png$/;
const GENERIC_CARD_THUMB_KEY_RE = /^cards\/generic\/([a-z0-9-]{1,80})\/[0-9a-f]{64}\.thumb\.webp$/;

/** Keys are matched against a strict shape so a corrupt index can never address other objects. */
export const cardKeyPartId = (key: unknown): string | null => {
  if (typeof key !== "string") return null;
  const m = CARD_KEY_RE.exec(key);
  return m ? m[1] : null;
};

export const cardThumbKeyPartId = (key: unknown): string | null => {
  if (typeof key !== "string") return null;
  const m = CARD_THUMB_KEY_RE.exec(key);
  return m ? m[1] : null;
};

export const genericCardKeyArchetype = (key: unknown): GenericCardArchetype | null => {
  if (typeof key !== "string") return null;
  const m = GENERIC_CARD_KEY_RE.exec(key);
  return m && isGenericCardArchetype(m[1]) ? m[1] : null;
};

export const genericCardThumbKeyArchetype = (key: unknown): GenericCardArchetype | null => {
  if (typeof key !== "string") return null;
  const m = GENERIC_CARD_THUMB_KEY_RE.exec(key);
  return m && isGenericCardArchetype(m[1]) ? m[1] : null;
};

const shaIn = (key: string): string | null => /\/([0-9a-f]{64})(?:\.thumb)?\.(?:png|webp)$/.exec(key)?.[1] ?? null;

const entryFields = (e: Record<string, unknown>, thumbKey?: string): Omit<CardIndexEntry, "key"> => ({
  mode: typeof e.mode === "string" ? e.mode : "unknown",
  ...(typeof e.promptHash === "string" ? { promptHash: e.promptHash } : {}),
  ...(typeof e.reviewedAt === "string" ? { reviewedAt: e.reviewedAt } : {}),
  ...(thumbKey ? { thumbKey } : {}),
});

/** Tolerant parse of `cards/index.json`: unknown/malformed entries are dropped, not fatal. */
export function parseCardIndex(raw: unknown): CardIndex {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CardIndex = {};
  for (const [partId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const e = value as Record<string, unknown>;
    // The key must be well formed *and* belong to this part id.
    if (cardKeyPartId(e.key) !== partId) continue;
    const thumbKey = cardThumbKeyPartId(e.thumbKey) === partId && shaIn(e.thumbKey as string) === shaIn(e.key as string) ? (e.thumbKey as string) : undefined;
    out[partId] = { key: e.key as string, ...entryFields(e, thumbKey) };
  }
  return out;
}

/** Tolerant parse of the separate reviewed generic-card index. */
export function parseGenericCardIndex(raw: unknown): GenericCardIndex {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: GenericCardIndex = {};
  for (const [archetype, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isGenericCardArchetype(archetype) || !value || typeof value !== "object") continue;
    const e = value as Record<string, unknown>;
    if (genericCardKeyArchetype(e.key) !== archetype) continue;
    const thumbKey =
      genericCardThumbKeyArchetype(e.thumbKey) === archetype && shaIn(e.thumbKey as string) === shaIn(e.key as string) ? (e.thumbKey as string) : undefined;
    out[archetype] = { key: e.key as string, ...entryFields(e, thumbKey) };
  }
  return out;
}

let cached: { at: number; bucket: R2Bucket; index: CardIndex } | null = null;
let cachedGeneric: { at: number; bucket: R2Bucket; index: GenericCardIndex } | null = null;

/** Test hook / hot-publish escape hatch. */
export const resetCardIndexCache = (): void => {
  cached = null;
  cachedGeneric = null;
};

export const r2CardStore = (bucket: R2Bucket, now: () => number = Date.now): CardStore => ({
  async index() {
    const t = now();
    if (cached && cached.bucket === bucket && t - cached.at < CARD_INDEX_TTL_MS) return cached.index;
    let index: CardIndex = {};
    try {
      const obj = await bucket.get(CARD_INDEX_KEY);
      if (obj) index = parseCardIndex(await obj.json());
    } catch {
      // A missing or unreadable index simply means "no cards" — renders must never fail on it.
      index = {};
    }
    cached = { at: t, bucket, index };
    return index;
  },
  async genericIndex() {
    const t = now();
    if (cachedGeneric && cachedGeneric.bucket === bucket && t - cachedGeneric.at < CARD_INDEX_TTL_MS) return cachedGeneric.index;
    let index: GenericCardIndex = {};
    try {
      const obj = await bucket.get(GENERIC_CARD_INDEX_KEY);
      if (obj) index = parseGenericCardIndex(await obj.json());
    } catch {
      index = {};
    }
    cachedGeneric = { at: t, bucket, index };
    return index;
  },
  async get(key) {
    if (!cardKeyPartId(key) && !cardThumbKeyPartId(key) && !genericCardKeyArchetype(key) && !genericCardThumbKeyArchetype(key)) return null;
    const obj = await bucket.get(key);
    if (!obj) return null;
    return { bytes: new Uint8Array(await obj.arrayBuffer()), contentType: obj.httpMetadata?.contentType ?? "image/png" };
  },
});

export interface MemoryCardStore extends CardStore {
  entries: CardIndex;
  genericEntries: GenericCardIndex;
  objects: Map<string, CardImage>;
  /** Publishes a fake card for `partId`; returns the key. */
  add(partId: string, opts?: { sha?: string; bytes?: Uint8Array; mode?: string; contentType?: string }): string;
  /** Publishes a fake reviewed generic source + thumbnail; returns the source key. */
  addGeneric(archetype: GenericCardArchetype, opts?: { sha?: string; bytes?: Uint8Array; thumbBytes?: Uint8Array }): string;
}

export const memoryCardStore = (): MemoryCardStore => {
  const entries: CardIndex = {};
  const genericEntries: GenericCardIndex = {};
  const objects = new Map<string, CardImage>();
  return {
    entries,
    genericEntries,
    objects,
    add(partId, opts = {}) {
      const sha = opts.sha ?? partId.padEnd(64, "0").slice(0, 64).replace(/[^0-9a-f]/g, "a");
      const key = cardKeyFor(partId, sha);
      const thumbKey = cardThumbKeyFor(partId, sha);
      entries[partId] = { key, thumbKey, mode: opts.mode ?? "attributes", reviewedAt: "2026-08-29T00:00:00.000Z" };
      objects.set(key, { bytes: opts.bytes ?? new Uint8Array([0x89, 0x50, 0x4e, 0x47]), contentType: opts.contentType ?? "image/png" });
      objects.set(thumbKey, { bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]), contentType: "image/webp" });
      return key;
    },
    addGeneric(archetype, opts = {}) {
      const sha = opts.sha ?? archetype.padEnd(64, "0").slice(0, 64).replace(/[^0-9a-f]/g, "a");
      const key = genericCardKeyFor(archetype, sha);
      const thumbKey = genericCardThumbKeyFor(archetype, sha);
      genericEntries[archetype] = { key, thumbKey, mode: "generic", reviewedAt: "2026-08-29T00:00:00.000Z" };
      objects.set(key, { bytes: opts.bytes ?? new Uint8Array([0x89, 0x50, 0x4e, 0x47]), contentType: "image/png" });
      objects.set(thumbKey, { bytes: opts.thumbBytes ?? new Uint8Array([0x52, 0x49, 0x46, 0x46]), contentType: "image/webp" });
      return key;
    },
    async index() {
      return parseCardIndex(entries);
    },
    async genericIndex() {
      return parseGenericCardIndex(genericEntries);
    },
    async get(key) {
      if (!cardKeyPartId(key) && !cardThumbKeyPartId(key) && !genericCardKeyArchetype(key) && !genericCardThumbKeyArchetype(key)) return null;
      return objects.get(key) ?? null;
    },
  };
};
