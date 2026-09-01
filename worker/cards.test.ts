import { describe, expect, it } from "vitest";
import { memoryCardStore } from "./card-store";
import { handleCardThumbnailGet } from "./cards";
import { toResponse } from "./http";

const get = (partId: string, fallback: string | null, cards: ReturnType<typeof memoryCardStore> | null, init?: RequestInit) =>
  handleCardThumbnailGet(new Request("http://x/api/cards/x/thumb.webp", init), partId, fallback, cards).catch(toResponse);

describe("GET /api/cards/:partId/thumb.webp", () => {
  it("serves the specific reviewed derivative ahead of a generic fallback", async () => {
    const cards = memoryCardStore();
    cards.add("gpu-test-5060");
    cards.addGeneric("gpu-2fan-slim", { thumbBytes: new Uint8Array([9]) });
    const res = await get("gpu-test-5060", "gpu-2fan-slim", cards);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("x-rigbuilder-card-kind")).toBe("specific");
    expect(res.headers.get("cache-control")).toContain("max-age=60");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x52, 0x49, 0x46, 0x46]));
  });

  it("serves a reviewed generic when the specific card or derivative is absent", async () => {
    const cards = memoryCardStore();
    cards.addGeneric("gpu-2fan-slim", { thumbBytes: new Uint8Array([1, 2, 3]) });
    const res = await get("gpu-missing", "gpu-2fan-slim", cards);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-rigbuilder-card-kind")).toBe("generic");
    expect(res.headers.get("x-rigbuilder-card-archetype")).toBe("gpu-2fan-slim");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("falls through a dangling specific thumbnail to the generic derivative", async () => {
    const cards = memoryCardStore();
    cards.add("gpu-test-5060");
    cards.objects.delete(cards.entries["gpu-test-5060"].thumbKey!);
    cards.addGeneric("gpu-2fan-slim", { thumbBytes: new Uint8Array([7]) });
    const res = await get("gpu-test-5060", "gpu-2fan-slim", cards);
    expect(res.headers.get("x-rigbuilder-card-kind")).toBe("generic");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([7]));
  });

  it("supports conditional GET and HEAD without marking mutable aliases immutable", async () => {
    const cards = memoryCardStore();
    cards.addGeneric("cpu-desktop");
    const first = await get("cpu-x", "cpu-desktop", cards);
    const etag = first.headers.get("etag")!;
    expect(first.headers.get("cache-control")).not.toContain("immutable");
    expect((await get("cpu-x", "cpu-desktop", cards, { headers: { "if-none-match": etag } })).status).toBe(304);
    const head = await get("cpu-x", "cpu-desktop", cards, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
  });

  it("rejects unknown fallbacks and missing storage without exposing arbitrary card keys", async () => {
    const cards = memoryCardStore();
    expect((await get("x", "../../secret", cards)).status).toBe(404);
    expect((await get("x", null, cards)).status).toBe(404);
    expect((await get("x", "cpu-desktop", null)).status).toBe(503);
  });
});
