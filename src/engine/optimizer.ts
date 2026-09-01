/**
 * fit_to_budget (DESIGN §6.4): bounded search over valid cheaper alternatives, one choice per category,
 * lexicographic objective, deterministic. Proposes ordered ops; never mutates the build.
 */
import { CATEGORIES, type Category, type Part } from "../data/schema";
import { buildTotalUSD, filledCategories, round2, withPart } from "./build";
import { alternatives, currentPart, goalPerfKey, noiseOf, sizeMetric, tieBreak, utility, type Alternative } from "./ranking";
import type { Build, CatalogIndex, Conflict, Goal, ValidationDelta } from "./types";
import { isAcceptableChange, validate, validationDelta } from "./validate";

export type Preserve = "performance" | "noise" | "size";
export const PRESERVES: readonly Preserve[] = ["performance", "noise", "size"];

export const MAX_ALTERNATIVES_PER_CATEGORY = 6;
export const EXHAUSTIVE_MAX_CATEGORIES = 5;
export const BEAM_WIDTH = 50;

export interface FitToBudgetOptions {
  budgetUSD: number;
  /** Categories that must not change. */
  protect?: readonly Category[];
  /** Metric to preserve; default from goal (quiet → noise, compact → size), else performance. */
  preserve?: Preserve;
  goal?: Goal;
}

export interface BudgetOp {
  op: "replace";
  category: Category;
  fromPartId: string;
  toPartId: string;
  savings: number;
  tradeoff: string;
}

export interface BudgetProposal {
  ok: true;
  ops: BudgetOp[];
  totalUSD: number;
  validation: Conflict[];
  delta: ValidationDelta;
  preserve: Preserve;
  /** Loss in the preserved metric (0 = nothing given up). */
  loss: number;
  swaps: number;
  combinationsEvaluated: number;
  method: "none" | "exhaustive" | "beam";
}

export interface BudgetInfeasible {
  ok: false;
  code: "BUDGET_INFEASIBLE";
  cheapestTotal: number;
  blockedBy: Category[];
  message: string;
}

export type FitToBudgetResult = BudgetProposal | BudgetInfeasible;

export function defaultPreserve(goal?: Goal): Preserve {
  if (goal?.preferences?.noise === "quiet") return "noise";
  if (goal?.preferences?.size === "compact") return "size";
  return "performance";
}

interface Choice {
  part: Part;
  /** undefined = keep the current part. */
  alt?: Alternative;
}

interface CategorySearch {
  category: Category;
  current: Part;
  /** Sorted by price ascending, then tie-break; "keep" is included. */
  choices: Choice[];
}

/** Objective tuple, compared lexicographically; lower is better on every position. */
type Score = [loss: number, swaps: number, negRetained: number, negTotal: number, negVerified: number, idKey: string];

function compareScore(a: Score, b: Score): number {
  for (let i = 0; i < 5; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d;
  }
  return a[5] < b[5] ? -1 : a[5] > b[5] ? 1 : 0;
}

export function preserveLoss(preserve: Preserve, from: Part, to: Part, goal?: Goal): number {
  switch (preserve) {
    case "performance": {
      if ((from.category !== "cpu" && from.category !== "gpu") || from.category !== to.category) return 0;
      const key = goalPerfKey(goal);
      const gaming = (goal?.useCase ?? "gaming") === "gaming";
      const weight = gaming ? (from.category === "gpu" ? 2 : 1.5) : 1;
      return Math.max(0, from.perfTier[key] - to.perfTier[key]) * weight;
    }
    case "noise": {
      const a = noiseOf(from);
      const b = noiseOf(to);
      return a == null || b == null ? 0 : Math.max(0, b - a);
    }
    case "size": {
      const a = sizeMetric(from);
      const b = sizeMetric(to);
      return a == null || b == null ? 0 : Math.max(0, b - a);
    }
  }
}

export function fitToBudget(build: Build, catalog: CatalogIndex, opts: FitToBudgetOptions): FitToBudgetResult {
  const { budgetUSD, goal } = opts;
  const preserve = opts.preserve ?? defaultPreserve(goal);
  const protect = new Set(opts.protect ?? []);
  const baseline = validate(build, goal);
  const baseTotal = buildTotalUSD(build);
  const filled = filledCategories(build);
  const blockedBy = filled.filter((c) => protect.has(c));

  if (baseTotal <= budgetUSD) {
    return {
      ok: true,
      ops: [],
      totalUSD: baseTotal,
      validation: baseline,
      delta: { added: [], removed: [] },
      preserve,
      loss: 0,
      swaps: 0,
      combinationsEvaluated: 1,
      method: "none",
    };
  }

  // Candidate choices per unprotected filled category.
  const searches: CategorySearch[] = [];
  for (const category of CATEGORIES) {
    if (!filled.includes(category) || protect.has(category)) continue;
    const current = currentPart(build, category)!;
    const res = alternatives(category, build, catalog, { direction: "cheaper", count: MAX_ALTERNATIVES_PER_CATEGORY, goal });
    if (!res.ok || !res.candidates.length) continue;
    const choices: Choice[] = [{ part: current }, ...res.candidates.map((alt) => ({ part: alt.part, alt }))];
    choices.sort((a, b) => a.part.priceUSD - b.part.priceUSD || tieBreak(a.part, b.part));
    searches.push({ category, current, choices });
  }

  const fixedCost = round2(baseTotal - searches.reduce((s, x) => s + x.current.priceUSD, 0));
  const cheapestTotal = round2(fixedCost + searches.reduce((s, x) => s + x.choices[0]!.part.priceUSD, 0));
  const infeasible = (): BudgetInfeasible => ({
    ok: false,
    code: "BUDGET_INFEASIBLE",
    cheapestTotal,
    blockedBy,
    message: `cheapest valid combination is $${cheapestTotal}, over the $${budgetUSD} budget` +
      (blockedBy.length ? ` (protected: ${blockedBy.join(", ")})` : ""),
  });
  if (!searches.length || cheapestTotal > budgetUSD) return infeasible();

  const applyChoices = (assignment: readonly Choice[]): Build => {
    let b = build;
    assignment.forEach((choice, i) => {
      if (choice.alt) b = withPart(b, choice.part, { replace: true, replacesPartId: searches[i]!.current.id });
    });
    return b;
  };

  interface Evaluated {
    assignment: Choice[];
    total: number;
    score: Score;
    conflicts: Conflict[];
    valid: boolean;
  }
  let evaluated = 0;
  const evaluate = (assignment: Choice[]): Evaluated => {
    evaluated++;
    const b = applyChoices(assignment);
    const total = buildTotalUSD(b);
    const conflicts = validate(b, goal);
    const valid = isAcceptableChange(baseline, conflicts);
    let loss = 0;
    let swaps = 0;
    let retained = 0;
    let verified = 0;
    const ids: string[] = [];
    assignment.forEach((choice, i) => {
      if (!choice.alt) return;
      const from = searches[i]!.current;
      swaps++;
      loss += preserveLoss(preserve, from, choice.part, goal);
      const uFrom = utility(from, goal);
      retained += uFrom > 0 ? utility(choice.part, goal) / uFrom : 1;
      if (choice.part.verified) verified++;
      ids.push(choice.part.id);
    });
    const score: Score = [round2(loss), swaps, -round2(retained), -total, -verified, ids.join(",")];
    return { assignment, total, score, conflicts, valid };
  };

  let best: Evaluated | undefined;
  const consider = (e: Evaluated) => {
    if (!e.valid || e.total > budgetUSD) return;
    if (!best || compareScore(e.score, best.score) < 0) best = e;
  };

  let method: BudgetProposal["method"];
  if (searches.length <= EXHAUSTIVE_MAX_CATEGORIES) {
    method = "exhaustive";
    const minRemaining: number[] = new Array(searches.length + 1).fill(0);
    for (let i = searches.length - 1; i >= 0; i--) minRemaining[i] = minRemaining[i + 1]! + searches[i]!.choices[0]!.part.priceUSD;
    const assignment: Choice[] = [];
    const dfs = (depth: number, sum: number) => {
      if (depth === searches.length) {
        consider(evaluate([...assignment]));
        return;
      }
      for (const choice of searches[depth]!.choices) {
        const next = sum + choice.part.priceUSD;
        if (next + minRemaining[depth + 1]! > budgetUSD + 1e-9) break; // choices sorted by price ascending
        assignment.push(choice);
        dfs(depth + 1, next);
        assignment.pop();
      }
    };
    dfs(0, fixedCost);
  } else {
    method = "beam";
    // Partial assignments are completed with "keep" for the remaining categories and ranked by the
    // objective alone; partials that cannot reach the budget even with the cheapest remaining choices are dropped.
    const minRemaining: number[] = new Array(searches.length + 1).fill(0);
    for (let i = searches.length - 1; i >= 0; i--) minRemaining[i] = minRemaining[i + 1]! + searches[i]!.choices[0]!.part.priceUSD;
    let beam: { assignment: Choice[]; sum: number }[] = [{ assignment: [], sum: fixedCost }];
    for (let depth = 0; depth < searches.length; depth++) {
      const expanded: { assignment: Choice[]; sum: number; e: Evaluated }[] = [];
      for (const partial of beam) {
        for (const choice of searches[depth]!.choices) {
          const sum = partial.sum + choice.part.priceUSD;
          if (sum + minRemaining[depth + 1]! > budgetUSD + 1e-9) break; // choices sorted by price ascending
          const assignment = [...partial.assignment, choice];
          const full = [...assignment, ...searches.slice(depth + 1).map((s) => s.choices.find((c) => !c.alt)!)];
          expanded.push({ assignment, sum, e: evaluate(full) });
        }
      }
      expanded.sort((a, b) => compareScore(a.e.score, b.e.score));
      if (depth === searches.length - 1) for (const x of expanded) consider(x.e);
      beam = expanded.slice(0, BEAM_WIDTH).map((x) => ({ assignment: x.assignment, sum: x.sum }));
    }
  }

  if (!best) return infeasible();

  const ops: BudgetOp[] = [];
  best.assignment.forEach((choice, i) => {
    if (!choice.alt) return;
    const s = searches[i]!;
    ops.push({
      op: "replace",
      category: s.category,
      fromPartId: s.current.id,
      toPartId: choice.part.id,
      savings: round2(s.current.priceUSD - choice.part.priceUSD),
      tradeoff: choice.alt.tradeoff,
    });
  });

  return {
    ok: true,
    ops,
    totalUSD: best.total,
    validation: best.conflicts,
    delta: validationDelta(baseline, best.conflicts),
    preserve,
    loss: best.score[0],
    swaps: best.score[1],
    combinationsEvaluated: evaluated,
    method,
  };
}
