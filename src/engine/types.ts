/**
 * Engine types — pure TS, no React/DOM. See docs/DESIGN.md §5–§6.
 */
import { CATEGORIES, MULTI_SLOT_CATEGORIES, type Category, type Part, type PartOf } from "../data/schema";
import type { WORKLOADS, RESOLUTIONS } from "../data/schema";

export type Workload = (typeof WORKLOADS)[number];
export type Resolution = (typeof RESOLUTIONS)[number];

/** A build: category → parts in that slot. Single-slot categories hold ≤ 1, ram/storage may hold several. */
export interface Build {
  slots: Partial<Record<Category, Part[]>>;
}

export type NoisePref = "quiet" | "standard";
export type SizePref = "compact" | "standard" | "any";
export type LightingPref = "rgb" | "none" | "any";
export type ColorPref = "black" | "white" | "any";

export interface GoalPreferences {
  noise?: NoisePref;
  size?: SizePref;
  lighting?: LightingPref;
  color?: ColorPref;
}

export interface Goal {
  useCase: Workload;
  budgetUSD: number;
  preferences?: GoalPreferences;
}

export type Severity = "error" | "warning" | "info";

export const RULE_CODES = [
  "SOCKET_MISMATCH",
  "CHIPSET_UNSUPPORTED",
  "RAM_TYPE_MISMATCH",
  "RAM_SLOTS_EXCEEDED",
  "RAM_SPEED_LIMITED",
  "FORM_FACTOR_MISMATCH",
  "GPU_TOO_LONG",
  "COOLER_TOO_TALL",
  "COOLER_SOCKET_UNSUPPORTED",
  "RADIATOR_UNSUPPORTED",
  "COOLER_UNDERSIZED",
  "PSU_INSUFFICIENT",
  "PSU_LOW_HEADROOM",
  "PSU_FORM_FACTOR",
  "NO_IGPU_NO_GPU",
  "M2_SLOTS_EXCEEDED",
  "SATA_PORTS_EXCEEDED",
  "PCIE_GEN_MISMATCH",
  "COOLER_MISSING",
  "OVER_BUDGET",
  "GOAL_SLOT_MISSING",
  "TIER_IMBALANCE",
  "GOAL_NOISE",
  "GOAL_SIZE",
] as const;
export type RuleCode = (typeof RULE_CODES)[number];

export interface Conflict {
  code: RuleCode;
  severity: Severity;
  partIds: string[];
  explanation: string;
}

export type RuleResultKind = "pass" | "fail" | "not_applicable" | "unknown";

export interface RuleResult {
  code: RuleCode;
  severity: Severity;
  result: RuleResultKind;
  reason: string;
  partIds: string[];
}

export type FitKind = "compatible" | "incompatible" | "conditional";

export interface FitCheck {
  code: RuleCode;
  severity: Severity;
  result: RuleResultKind;
  reason: string;
  /** The rule already fails with the candidate's category emptied — the candidate is not the cause. */
  preexisting?: boolean;
}

export interface FitResult {
  fit: FitKind;
  checks: FitCheck[];
  /** Rule codes that could not be evaluated yet (needed slot empty). */
  pending: RuleCode[];
  /** Error codes that fail regardless of this candidate (pre-existing, caused by other slots); they do not block. */
  preexisting: RuleCode[];
}

export interface ValidationDelta {
  added: RuleCode[];
  removed: RuleCode[];
}

/** Indexed catalog used by every engine function. Build one with `indexCatalog`. */
export interface CatalogIndex {
  parts: readonly Part[];
  byId: ReadonlyMap<string, Part>;
  byCategory: { readonly [C in Category]: readonly PartOf<C>[] };
}

/** Accepts a plain part array or anything with a `parts` array (e.g. the schema `Catalog`). */
export function indexCatalog(input: readonly Part[] | { parts: readonly Part[] }): CatalogIndex {
  const parts = Array.isArray(input) ? (input as readonly Part[]) : (input as { parts: readonly Part[] }).parts;
  const byId = new Map<string, Part>();
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, [] as Part[]])) as Record<Category, Part[]>;
  for (const p of parts) {
    byId.set(p.id, p);
    byCategory[p.category].push(p);
  }
  for (const c of CATEGORIES) byCategory[c].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { parts, byId, byCategory: byCategory as CatalogIndex["byCategory"] };
}

export const isMultiSlot = (category: Category): boolean => MULTI_SLOT_CATEGORIES.includes(category);
