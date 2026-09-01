import type { GenericCardArchetype } from "../engine/cardArchetype";

export type IndexedCardKind = "specific" | "generic" | "none";

/** Resolve the same precedence as the thumbnail route without exposing either R2 index key. */
export function resolveIndexedCardKind(
  partId: string,
  fallback: GenericCardArchetype,
  specificPartIds: ReadonlySet<string>,
  genericArchetypes: ReadonlySet<string>,
): IndexedCardKind {
  if (specificPartIds.has(partId)) return "specific";
  return genericArchetypes.has(fallback) ? "generic" : "none";
}
