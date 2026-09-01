/**
 * Shared validation for client-supplied build payloads (render + share). The Worker
 * accepts ids + enums for shared build state (DESIGN.md §4.3, §8): bodies are strict, capped at 2 KB, every
 * id must exist in the published catalog, and single-slot categories hold at most one part.
 */
import { z } from "zod";
import { CATEGORIES, MULTI_SLOT_CATEGORIES, WORKLOADS, type Category, type Part } from "../src/data/schema";
import { buildCatalog } from "./catalog";
import { ApiError } from "./http";
import type { CatalogRepo } from "./repo";

export const PAYLOAD_MAX_BYTES = 2 * 1024;
export const MAX_PART_IDS = 24;

export const goalSchema = z
  .object({
    useCase: z.enum(WORKLOADS),
    budgetUSD: z.number().positive().max(100_000),
    preferences: z
      .object({
        noise: z.enum(["quiet", "standard"]).optional(),
        size: z.enum(["compact", "standard", "any"]).optional(),
        lighting: z.enum(["rgb", "none", "any"]).optional(),
        color: z.enum(["black", "white", "any"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type GoalInput = z.infer<typeof goalSchema>;

export const partIdSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);
export const partIdsSchema = z.array(partIdSchema).min(1).max(MAX_PART_IDS);

export const zodDetails = (err: z.ZodError) =>
  err.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message }));

export const parseOr400 = <S extends z.ZodType>(schema: S, input: unknown): z.output<S> => {
  const res = schema.safeParse(input);
  if (!res.success) throw new ApiError(400, "INVALID_INPUT", "Validation failed", zodDetails(res.error));
  return res.data as z.output<S>;
};

// ---------- per-isolate id → part cache (60 s) ----------

export interface PartIndex {
  byId: Map<string, Part>;
  catalogVersion: number;
}

const CACHE_TTL_MS = 60 * 1000;
let cached: { at: number; index: PartIndex; repo: CatalogRepo } | null = null;

export async function partIndexFor(repo: CatalogRepo, now: number = Date.now()): Promise<PartIndex> {
  if (cached && cached.repo === repo && now - cached.at < CACHE_TTL_MS) return cached.index;
  const { catalog } = await buildCatalog(repo);
  const byId = new Map<string, Part>();
  for (const p of catalog.parts) byId.set(p.id, p);
  const index = { byId, catalogVersion: catalog.catalogVersion };
  cached = { at: now, index, repo };
  return index;
}

/** Test hook. */
export const resetPartIndexCache = (): void => {
  cached = null;
};

/**
 * Resolves ids to parts (deduplicated, catalog order preserved as given) and groups them
 * into slots. Unknown id → 400 UNKNOWN_PART; two parts in a single-slot category → 400 INVALID_INPUT.
 */
export function resolveParts(ids: readonly string[], index: PartIndex): { parts: Part[]; slots: Partial<Record<Category, Part[]>> } {
  const seen = new Set<string>();
  const parts: Part[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const p = index.byId.get(id);
    if (!p) unknown.push(id);
    else parts.push(p);
  }
  if (unknown.length) throw new ApiError(400, "UNKNOWN_PART", "Unknown part id(s)", { partIds: unknown });

  const slots: Partial<Record<Category, Part[]>> = {};
  for (const p of parts) (slots[p.category] ??= []).push(p);
  for (const c of CATEGORIES) {
    const n = slots[c]?.length ?? 0;
    if (n > 1 && !MULTI_SLOT_CATEGORIES.includes(c)) {
      throw new ApiError(400, "INVALID_INPUT", `Category ${c} holds at most one part`, { category: c, partIds: slots[c]!.map((p) => p.id) });
    }
  }
  return { parts, slots };
}

export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
