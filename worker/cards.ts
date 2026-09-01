/** Public, same-origin thumbnail delivery for reviewed part cards and generic fallbacks. */
import { isGenericCardArchetype } from "../src/engine/cardArchetype";
import type { CardIndex, CardStore, GenericCardIndex } from "./card-store";
import { ApiError } from "./http";

export const CARD_THUMB_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=600";

const etagMatches = (header: string | null, etag: string): boolean => {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((token) => token.trim().replace(/^W\//, ""))
    .includes(etag);
};

const shaFromKey = (key: string): string => /\/([0-9a-f]{64})\.thumb\.webp$/.exec(key)?.[1] ?? "unknown";

export async function handleCardThumbnailGet(request: Request, partId: string, fallback: string | null, cards: CardStore | null): Promise<Response> {
  if (!cards) throw new ApiError(503, "CARD_UNAVAILABLE", "Part-card storage is not configured");

  let key: string | undefined;
  let kind: "specific" | "generic" = "specific";
  let archetype: string | undefined;
  const specific = await cards.index().catch((): CardIndex => ({}));
  key = specific[partId]?.thumbKey;

  if (!key && isGenericCardArchetype(fallback)) {
    const generic = await cards.genericIndex().catch((): GenericCardIndex => ({}));
    key = generic[fallback]?.thumbKey;
    kind = "generic";
    archetype = fallback;
  }
  if (!key) throw new ApiError(404, "NOT_FOUND", "No reviewed thumbnail for this part");

  let obj = await cards.get(key).catch(() => null);
  // A dangling specific derivative should still degrade to the reviewed generic placeholder.
  if (!obj && kind === "specific" && isGenericCardArchetype(fallback)) {
    const generic = await cards.genericIndex().catch((): GenericCardIndex => ({}));
    const genericKey = generic[fallback]?.thumbKey;
    if (genericKey) {
      key = genericKey;
      obj = await cards.get(genericKey).catch(() => null);
      kind = "generic";
      archetype = fallback;
    }
  }
  if (!obj || !key) throw new ApiError(404, "NOT_FOUND", "Reviewed thumbnail object is missing");

  const sha = shaFromKey(key);
  const etag = `"${sha}"`;
  const headers: Record<string, string> = {
    "content-type": "image/webp",
    "content-length": String(obj.bytes.byteLength),
    "cache-control": CARD_THUMB_CACHE_CONTROL,
    etag,
    "x-content-type-options": "nosniff",
    "x-rigbuilder-card-kind": kind,
    ...(archetype ? { "x-rigbuilder-card-archetype": archetype } : {}),
  };
  if (etagMatches(request.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : (obj.bytes as BodyInit), { status: 200, headers });
}
