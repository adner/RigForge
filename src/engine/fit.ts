/**
 * Tri-state fit of a candidate part against the current build (DESIGN §4.1 search_parts / explain_compatibility).
 * The candidate is evaluated as if placed: replacing the existing single-slot part, or appended for multi-slot.
 */
import type { Category, Part, PartOf } from "../data/schema";
import { withPart, withoutCategory } from "./build";
import { RULES, evaluateRule, type Rule } from "./rules";
import { isMultiSlot, type Build, type CatalogIndex, type FitResult, type Goal } from "./types";

/** Rules that look at the given category (needed or optional slot). */
export function rulesFor(category: Category): Rule[] {
  return RULES.filter((r) => r.needs.includes(category) || r.involves.includes(category));
}

/** Places the candidate into the build the way `fit` evaluates it (replace single-slot, append multi-slot). */
export function placeCandidate(candidate: Part, build: Build): Build {
  return withPart(build, candidate, { replace: true });
}

export function fit(candidate: Part, build: Build, goal?: Goal): FitResult {
  const hypothetical = placeCandidate(candidate, build);
  // Baseline: the build with the candidate's whole category emptied. A rule that fails on the
  // baseline is caused by *other* slots (e.g. an undersized PSU when evaluating CPUs) and must not
  // mark every candidate incompatible; a rule that needs this category goes `unknown` on the
  // baseline, so a genuinely bad candidate (too-long GPU) is still blocked.
  // Multi-slot categories append, so the baseline is simply the build without the candidate.
  const baseline = isMultiSlot(candidate.category) ? build : withoutCategory(build, candidate.category);
  const checks = rulesFor(candidate.category)
    .map((rule) => {
      const r = evaluateRule(rule, { build: hypothetical, goal });
      const preexisting =
        r.severity === "error" && r.result === "fail" && evaluateRule(rule, { build: baseline, goal }).result === "fail";
      return { code: r.code, severity: r.severity, result: r.result, reason: r.reason, ...(preexisting ? { preexisting } : {}) };
    })
    .filter((r) => r.result !== "not_applicable" || r.severity === "error");
  const pending = checks.filter((c) => c.result === "unknown").map((c) => c.code);
  const preexisting = checks.filter((c) => c.preexisting).map((c) => c.code);
  const blocked = checks.some((c) => c.severity === "error" && c.result === "fail" && !c.preexisting);
  const conditional = checks.some((c) => c.severity === "error" && c.result === "unknown");
  return { fit: blocked ? "incompatible" : conditional ? "conditional" : "compatible", checks, pending, preexisting };
}

export interface PartFit<C extends Category = Category> {
  part: PartOf<C>;
  fit: FitResult;
}

/** Every catalog part of `category` with its FitResult, in id order. Filter on `fit.fit` as needed. */
export function compatibleParts<C extends Category>(
  category: C,
  build: Build,
  catalog: CatalogIndex,
  goal?: Goal,
): PartFit<C>[] {
  return catalog.byCategory[category].map((part) => ({ part, fit: fit(part, build, goal) }));
}
