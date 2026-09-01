import { beforeEach, describe, expect, it } from "vitest";
import {
  CARD_INDEX_KEY,
  CARD_INDEX_TTL_MS,
  GENERIC_CARD_INDEX_KEY,
  cardKeyFor,
  cardKeyPartId,
  cardThumbKeyFor,
  genericCardKeyFor,
  genericCardThumbKeyFor,
  memoryCardStore,
  parseCardIndex,
  parseGenericCardIndex,
  r2CardStore,
  resetCardIndexCache,
} from "./card-store";

const SHA = "a".repeat(64);
const KEY = cardKeyFor("case-fractal-terra", SHA);
const THUMB = cardThumbKeyFor("case-fractal-terra", SHA);

describe("card index", () => {
  it("accepts well-formed entries and drops anything else", () => {
    const index = parseCardIndex({
      "case-fractal-terra": { key: KEY, thumbKey: THUMB, mode: "reference", promptHash: "abc", reviewedAt: "2026-08-29T00:00:00.000Z" },
      "gpu-a": { key: "cards/gpu-a/short.png" }, // not a sha256 key
      "gpu-b": { key: "renders/deadbeef.webp" }, // wrong prefix
      "gpu-c": { key: `cards/gpu-other/${SHA}.png` }, // key belongs to a different part
      "gpu-d": { key: `cards/gpu-d/../../${SHA}.png` }, // traversal
      "gpu-e": "nope",
    });
    expect(Object.keys(index)).toEqual(["case-fractal-terra"]);
    expect(index["case-fractal-terra"]).toEqual({ key: KEY, thumbKey: THUMB, mode: "reference", promptHash: "abc", reviewedAt: "2026-08-29T00:00:00.000Z" });
    expect(parseCardIndex(null)).toEqual({});
    expect(parseCardIndex([{ key: KEY }])).toEqual({});
    expect(cardKeyPartId(KEY)).toBe("case-fractal-terra");
    expect(cardKeyPartId("cards/x/y.png")).toBeNull();
  });

  it("validates generic keys, archetypes and matching thumbnail hashes", () => {
    const key = genericCardKeyFor("gpu-2fan-thick", SHA);
    const thumbKey = genericCardThumbKeyFor("gpu-2fan-thick", SHA);
    expect(parseGenericCardIndex({ "gpu-2fan-thick": { key, thumbKey, mode: "generic" } })).toEqual({
      "gpu-2fan-thick": { key, thumbKey, mode: "generic" },
    });
    expect(parseGenericCardIndex({ "not-an-archetype": { key }, "gpu-2fan-thick": { key: key.replace("gpu-2fan-thick", "gpu-3fan-xl") } })).toEqual({});
    expect(parseGenericCardIndex({ "gpu-2fan-thick": { key, thumbKey: genericCardThumbKeyFor("gpu-2fan-thick", "b".repeat(64)) } })["gpu-2fan-thick"]?.thumbKey).toBeUndefined();
  });
});

describe("r2CardStore", () => {
  let gets: string[];
  let bucket: R2Bucket;
  let indexBody: unknown;

  beforeEach(() => {
    resetCardIndexCache();
    gets = [];
    indexBody = { "case-fractal-terra": { key: KEY, mode: "attributes" } };
    bucket = {
      async get(key: string) {
        gets.push(key);
        if (key === CARD_INDEX_KEY) return indexBody === null ? null : { json: async () => indexBody };
        if (key === GENERIC_CARD_INDEX_KEY) return { json: async () => ({}) };
        if (key === KEY) return { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, httpMetadata: { contentType: "image/png" } };
        return null;
      },
    } as unknown as R2Bucket;
  });

  it("reads the index once per isolate and re-reads after the TTL", async () => {
    let now = 1_000;
    const store = r2CardStore(bucket, () => now);
    expect(await store.index()).toEqual({ "case-fractal-terra": { key: KEY, mode: "attributes" } });
    await store.index();
    expect(gets).toEqual([CARD_INDEX_KEY]);

    now += CARD_INDEX_TTL_MS + 1;
    await store.index();
    expect(gets).toEqual([CARD_INDEX_KEY, CARD_INDEX_KEY]);
  });

  it("reads and caches the generic index independently", async () => {
    const store = r2CardStore(bucket, () => 1);
    expect(await store.genericIndex()).toEqual({});
    await store.genericIndex();
    expect(gets.filter((key) => key === GENERIC_CARD_INDEX_KEY)).toHaveLength(1);
  });

  it("treats a missing or unreadable index as 'no cards' instead of throwing", async () => {
    indexBody = null;
    expect(await r2CardStore(bucket, () => 1).index()).toEqual({});
    resetCardIndexCache();
    indexBody = "not an object";
    expect(await r2CardStore(bucket, () => 2).index()).toEqual({});
  });

  it("fetches bytes by key and refuses keys outside the cards/ shape", async () => {
    const store = r2CardStore(bucket, () => 1);
    expect(await store.get(KEY)).toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" });
    expect(await store.get("renders/deadbeef.webp")).toBeNull();
    expect(await store.get(`cards/other/${SHA}.png`)).toBeNull(); // valid shape, absent object
    expect(gets).toContain(KEY);
    expect(gets).not.toContain("renders/deadbeef.webp");
  });
});

describe("memoryCardStore", () => {
  it("publishes fake cards addressable by key", async () => {
    const store = memoryCardStore();
    const key = store.add("gpu-test-5060", { mode: "description" });
    expect(await store.index()).toEqual({ "gpu-test-5060": expect.objectContaining({ key, mode: "description" }) });
    expect((await store.get(key))?.contentType).toBe("image/png");
    expect(await store.get("cards/gpu-test-5060/nope.png")).toBeNull();
  });

  it("publishes fake reviewed generic sources and thumbnails", async () => {
    const store = memoryCardStore();
    const key = store.addGeneric("gpu-2fan-thick");
    expect(await store.genericIndex()).toEqual({ "gpu-2fan-thick": expect.objectContaining({ key, mode: "generic", thumbKey: expect.stringMatching(/\.thumb\.webp$/) }) });
    expect((await store.get(store.genericEntries["gpu-2fan-thick"]!.thumbKey!))?.contentType).toBe("image/webp");
  });
});
