/**
 * Immutable build helpers (pure). Used by the tool layer for add/remove/hypothetical ops.
 */
import { CATEGORIES, type Category, type Part, type PartOf } from "../data/schema";
import { isMultiSlot, type Build } from "./types";

export const emptyBuild = (): Build => ({ slots: {} });

export function partsIn<C extends Category>(build: Build, category: C): PartOf<C>[] {
  return (build.slots[category] ?? []) as PartOf<C>[];
}

/** First (only) part of a single-slot category, or undefined. */
export function single<C extends Category>(build: Build, category: C): PartOf<C> | undefined {
  return partsIn(build, category)[0];
}

export function allParts(build: Build): Part[] {
  const out: Part[] = [];
  for (const c of CATEGORIES) out.push(...(build.slots[c] ?? []));
  return out;
}

export function buildTotalUSD(build: Build): number {
  return round2(allParts(build).reduce((s, p) => s + p.priceUSD, 0));
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export function buildFromParts(parts: readonly Part[]): Build {
  let b = emptyBuild();
  for (const p of parts) b = withPart(b, p);
  return b;
}

export interface WithPartOptions {
  /** Single-slot: replace the existing part. Ignored for multi-slot (use replacesPartId). */
  replace?: boolean;
  /** Multi-slot: swap this specific part. Also honoured for single-slot. */
  replacesPartId?: string;
}

export class SlotOccupiedError extends Error {
  readonly code = "SLOT_OCCUPIED" as const;
  constructor(
    readonly category: Category,
    readonly occupiedBy: string,
  ) {
    super(`slot ${category} is occupied by ${occupiedBy}`);
  }
}

/**
 * Returns a new build with `part` placed. Single-slot categories throw SlotOccupiedError when occupied
 * unless `replace` or `replacesPartId` is given; multi-slot categories append unless `replacesPartId` is given.
 */
export function withPart(build: Build, part: Part, opts: WithPartOptions = {}): Build {
  const cat = part.category;
  const current = build.slots[cat] ?? [];
  let next: Part[];
  if (opts.replacesPartId) {
    const idx = current.findIndex((p) => p.id === opts.replacesPartId);
    next = idx >= 0 ? current.map((p, i) => (i === idx ? part : p)) : [...current, part];
    if (!isMultiSlot(cat) && idx < 0 && current.length > 0) {
      if (!opts.replace) throw new SlotOccupiedError(cat, current[0]!.id);
      next = [part];
    }
  } else if (isMultiSlot(cat)) {
    next = [...current, part];
  } else if (current.length > 0) {
    if (!opts.replace) throw new SlotOccupiedError(cat, current[0]!.id);
    next = [part];
  } else {
    next = [part];
  }
  return { slots: { ...build.slots, [cat]: next } };
}

/** Removes the part with `partId` (first match). Returns the same build if absent. */
export function withoutPart(build: Build, partId: string): Build {
  for (const c of CATEGORIES) {
    const list = build.slots[c];
    if (!list) continue;
    const idx = list.findIndex((p) => p.id === partId);
    if (idx < 0) continue;
    const next = list.filter((_, i) => i !== idx);
    const slots = { ...build.slots };
    if (next.length) slots[c] = next;
    else delete slots[c];
    return { slots };
  }
  return build;
}

/** Removes every part in a category. */
export function withoutCategory(build: Build, category: Category): Build {
  if (!build.slots[category]) return build;
  const slots = { ...build.slots };
  delete slots[category];
  return { slots };
}

export function filledCategories(build: Build): Category[] {
  return CATEGORIES.filter((c) => (build.slots[c]?.length ?? 0) > 0);
}
