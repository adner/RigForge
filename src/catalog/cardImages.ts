import type { Category, Part } from "../data/schema";
import { defaultGenericCardArchetype, genericCardArchetype, type GenericCardArchetype } from "../engine/cardArchetype";

export const cardThumbnailUrl = (partId: string, fallback: GenericCardArchetype): string =>
  `/api/cards/${encodeURIComponent(partId)}/thumb.webp?fallback=${encodeURIComponent(fallback)}`;

export const partThumbnailUrl = (part: Part): string => cardThumbnailUrl(part.id, genericCardArchetype(part));

export const categoryThumbnailUrl = (partId: string, category: Category): string => cardThumbnailUrl(partId, defaultGenericCardArchetype(category));
