/**
 * Alternatives ranking and per-category utility (DESIGN §6.3).
 */
import { PSU_EFFICIENCIES, type Category, type Part, type PartOf } from "../data/schema";
import { partsIn, withPart } from "./build";
import { FORM_FACTOR_RANK, PERF_KEY_BY_WORKLOAD, PSU_FORM_FACTOR_RANK } from "./rules";
import type { Build, CatalogIndex, Goal, ValidationDelta } from "./types";
import { isAcceptableChange, validate, validationDelta } from "./validate";

export type Direction = "cheaper" | "better" | "quieter" | "smaller";
export const DIRECTIONS: readonly Direction[] = ["cheaper", "better", "quieter", "smaller"];

const ALL: readonly Category[] = ["cpu", "motherboard", "ram", "gpu", "cooler", "case", "psu", "storage"];
export const DIRECTION_CATEGORIES: Record<Direction, readonly Category[]> = {
  cheaper: ALL,
  better: ALL,
  quieter: ["cooler", "gpu", "psu", "case"],
  smaller: ["case", "cooler", "motherboard", "psu"],
};

export function applicableDirections(category: Category): Direction[] {
  return DIRECTIONS.filter((d) => DIRECTION_CATEGORIES[d].includes(category));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Perf key used for CPU/GPU utility: the goal workload's key, default gaming1440p. */
export const goalPerfKey = (goal?: Goal) => PERF_KEY_BY_WORKLOAD[goal?.useCase ?? "gaming"];

/** Utility per category (§6.3). Higher is better. Deterministic, catalog-independent. */
export function utility(part: Part, goal?: Goal): number {
  switch (part.category) {
    case "cpu":
    case "gpu":
      return part.perfTier[goalPerfKey(goal)];
    case "ram":
      return round2((part.sticks * part.capacityPerStickGB * part.speedMHz) / 1000);
    case "storage":
      return round2((part.capacityGB * (part.interface === "sata" ? 2 : (part.pcieGen ?? 3))) / 1000);
    case "psu":
      return round2(part.wattage / 100 + PSU_EFFICIENCIES.indexOf(part.efficiency));
    case "cooler":
      return part.tdpRatingW;
    case "case":
      return round2((part.maxGpuLengthMm + part.maxCoolerHeightMm) / part.volumeLiters);
    case "motherboard":
      return part.m2Slots + part.ramSlots + part.pcieGen;
  }
}

/** Size metric for the `smaller` direction; undefined where not applicable. */
export function sizeMetric(part: Part): number | undefined {
  switch (part.category) {
    case "case":
      return part.volumeLiters;
    case "cooler":
      return part.type === "air" ? (part.heightMm ?? 0) : (part.radiatorMm ?? 0);
    case "motherboard":
      return FORM_FACTOR_RANK[part.formFactor];
    case "psu":
      return PSU_FORM_FACTOR_RANK[part.formFactor];
    default:
      return undefined;
  }
}

export function noiseOf(part: Part): number | undefined {
  return "noiseTier" in part ? part.noiseTier : undefined;
}

/** Key spec fields compared in `specDelta`, per category. */
const SPEC_FIELDS: Record<Category, readonly string[]> = {
  cpu: ["cores", "threads", "boostClockMHz", "tdpW", "hasIgpu", "includesCooler"],
  motherboard: ["formFactor", "chipset", "ddrGen", "maxRamSpeedMHz", "ramSlots", "m2Slots", "sataPorts", "pcieGen"],
  ram: ["sticks", "capacityPerStickGB", "speedMHz", "ddrGen", "hasRgb"],
  gpu: ["vramGB", "lengthMm", "tdpW", "pcieGen", "recommendedPsuW", "noiseTier"],
  cooler: ["type", "heightMm", "radiatorMm", "tdpRatingW", "noiseTier", "hasRgb"],
  case: ["volumeLiters", "maxGpuLengthMm", "maxCoolerHeightMm", "formFactorSupport", "color", "noiseTier"],
  psu: ["wattage", "efficiency", "formFactor", "modular", "noiseTier"],
  storage: ["capacityGB", "interface", "pcieGen"],
};

export type SpecValue = string | number | boolean | null;
export type SpecDelta = Record<string, { from: SpecValue; to: SpecValue }>;

function specValue(part: Part, field: string): SpecValue {
  const v = (part as unknown as Record<string, unknown>)[field];
  if (v == null) return null;
  if (Array.isArray(v)) return v.join("/");
  return v as SpecValue;
}

export function specDelta(from: Part | undefined, to: Part, goal?: Goal): SpecDelta {
  const out: SpecDelta = {};
  for (const f of SPEC_FIELDS[to.category]) {
    const a = from ? specValue(from, f) : null;
    const b = specValue(to, f);
    if (a !== b) out[f] = { from: a, to: b };
  }
  if (to.category === "cpu" || to.category === "gpu") {
    const key = goalPerfKey(goal);
    const a = from && from.category === to.category ? from.perfTier[key] : null;
    const b = to.perfTier[key];
    if (a !== b) out[`perfTier.${key}`] = { from: a, to: b };
  }
  return out;
}

export interface Alternative<C extends Category = Category> {
  part: PartOf<C>;
  verified: boolean;
  priceDelta: number;
  utility: number;
  utilityDelta: number;
  specDelta: SpecDelta;
  validation: ValidationDelta;
  tradeoff: string;
}

export interface AlternativesOptions {
  direction?: Direction;
  count?: number;
  goal?: Goal;
  /** Multi-slot categories: which item is being replaced (default: the most expensive one). */
  currentPartId?: string;
}

export type AlternativesResult<C extends Category = Category> =
  | { ok: true; current?: PartOf<C>; direction?: Direction; candidates: Alternative<C>[] }
  | { ok: false; code: "DIRECTION_NOT_APPLICABLE"; direction: Direction; applicable: Direction[]; message: string };

/** The part in `category` that a swap would replace: the only part, or (multi-slot) the requested / most expensive one. */
export function currentPart<C extends Category>(build: Build, category: C, currentPartId?: string): PartOf<C> | undefined {
  const parts = partsIn(build, category);
  if (!parts.length) return undefined;
  if (currentPartId) return parts.find((p) => p.id === currentPartId);
  return parts.reduce((best, p) => (p.priceUSD > best.priceUSD ? p : best), parts[0]!);
}

export function tieBreak(a: Part, b: Part): number {
  if (a.verified !== b.verified) return a.verified ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface Scored<C extends Category> {
  alt: Alternative<C>;
  noise: number;
  size: number;
}

function comparator<C extends Category>(direction: Direction | undefined, current: Part | undefined) {
  const byPriceAsc = (a: Scored<C>, b: Scored<C>) => a.alt.part.priceUSD - b.alt.part.priceUSD;
  const byUtilDesc = (a: Scored<C>, b: Scored<C>) => b.alt.utility - a.alt.utility;
  const chain =
    (...fns: ((a: Scored<C>, b: Scored<C>) => number)[]) =>
    (a: Scored<C>, b: Scored<C>) => {
      for (const f of fns) {
        const r = f(a, b);
        if (r !== 0) return r;
      }
      return tieBreak(a.alt.part, b.alt.part);
    };
  switch (direction) {
    case "cheaper":
      return chain(byPriceAsc, byUtilDesc);
    case "better":
      return chain(byUtilDesc, byPriceAsc);
    case "quieter":
      return chain((a, b) => a.noise - b.noise, byPriceAsc);
    case "smaller":
      return chain((a, b) => a.size - b.size, byPriceAsc);
    default: {
      const ref = current?.priceUSD ?? 0;
      return chain((a, b) => Math.abs(a.alt.part.priceUSD - ref) - Math.abs(b.alt.part.priceUSD - ref), byUtilDesc);
    }
  }
}

function describeTradeoff(alt: { part: Part; priceDelta: number; specDelta: SpecDelta; validation: ValidationDelta }, current: Part | undefined, goal?: Goal): string {
  const bits: string[] = [];
  const d = alt.priceDelta;
  if (!current) bits.push(`$${alt.part.priceUSD}`);
  else if (d < 0) bits.push(`$${round2(-d)} cheaper`);
  else if (d > 0) bits.push(`$${round2(d)} more`);
  else bits.push("same price");
  const key = goalPerfKey(goal);
  const perf = alt.specDelta[`perfTier.${key}`];
  if (perf && perf.from != null) bits.push(`${key} tier ${perf.from} → ${perf.to}`);
  const shown = Object.entries(alt.specDelta)
    .filter(([k]) => !k.startsWith("perfTier."))
    .slice(0, 2)
    .map(([k, v]) => `${k} ${v.from ?? "—"} → ${v.to ?? "—"}`);
  bits.push(...shown);
  if (alt.validation.added.length) bits.push(`adds ${alt.validation.added.join(", ")}`);
  if (alt.validation.removed.length) bits.push(`clears ${alt.validation.removed.join(", ")}`);
  return bits.join("; ");
}

/**
 * Candidates for `category` whose swap introduces no new errors and does not worsen existing conflicts,
 * ranked per direction (§6.3). Inapplicable direction → DIRECTION_NOT_APPLICABLE with the applicable list.
 */
export function alternatives<C extends Category>(
  category: C,
  build: Build,
  catalog: CatalogIndex,
  opts: AlternativesOptions = {},
): AlternativesResult<C> {
  const { direction, goal } = opts;
  const count = Math.max(1, Math.min(opts.count ?? 3, 6));
  if (direction && !DIRECTION_CATEGORIES[direction].includes(category)) {
    const applicable = applicableDirections(category);
    return {
      ok: false,
      code: "DIRECTION_NOT_APPLICABLE",
      direction,
      applicable,
      message: `direction "${direction}" does not apply to ${category}; applicable: ${applicable.join(", ")}`,
    };
  }
  const current = currentPart(build, category, opts.currentPartId);
  const baseline = validate(build, goal);
  const curUtility = current ? utility(current, goal) : 0;
  const curNoise = current ? noiseOf(current) : undefined;
  const curSize = current ? sizeMetric(current) : undefined;

  const scored: Scored<C>[] = [];
  for (const part of catalog.byCategory[category]) {
    if (part.status !== "published") continue;
    if (current && part.id === current.id) continue;
    const u = utility(part, goal);
    const noise = noiseOf(part) ?? 0;
    const size = sizeMetric(part) ?? 0;
    if (current) {
      if (direction === "cheaper" && part.priceUSD >= current.priceUSD) continue;
      if (direction === "better" && u <= curUtility) continue;
      if (direction === "quieter" && curNoise != null && noise >= curNoise) continue;
      if (direction === "smaller" && curSize != null && size >= curSize) continue;
      if (direction === undefined && u < curUtility) continue;
    }
    const next = withPart(build, part, { replace: true, replacesPartId: current?.id });
    const after = validate(next, goal);
    if (!isAcceptableChange(baseline, after)) continue;
    const alt: Alternative<C> = {
      part,
      verified: part.verified,
      priceDelta: round2(part.priceUSD - (current?.priceUSD ?? 0)),
      utility: u,
      utilityDelta: round2(u - curUtility),
      specDelta: specDelta(current, part, goal),
      validation: validationDelta(baseline, after),
      tradeoff: "",
    };
    alt.tradeoff = describeTradeoff(alt, current, goal);
    scored.push({ alt, noise, size });
  }
  scored.sort(comparator<C>(direction, current));
  return { ok: true, current, direction, candidates: scored.slice(0, count).map((s) => s.alt) };
}
