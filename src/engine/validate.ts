/**
 * validate(build, goal?) → Conflict[] (DESIGN §5). Only failed rules become conflicts; `unknown` never does.
 */
import { evaluateAll } from "./rules";
import type { Build, Conflict, Goal, RuleCode, ValidationDelta } from "./types";

export { estimateWattage, psuHeadroomPct, wattageBreakdown } from "./power";

export function validate(build: Build, goal?: Goal): Conflict[] {
  return evaluateAll({ build, goal })
    .filter((r) => r.result === "fail")
    .map((r) => ({ code: r.code, severity: r.severity, partIds: r.partIds, explanation: r.reason }));
}

export interface ValidationCounts {
  errors: number;
  warnings: number;
  info: number;
}

export function countConflicts(conflicts: readonly Conflict[]): ValidationCounts {
  const c = { errors: 0, warnings: 0, info: 0 };
  for (const x of conflicts) {
    if (x.severity === "error") c.errors++;
    else if (x.severity === "warning") c.warnings++;
    else c.info++;
  }
  return c;
}

/** Codes present after but not before (`added`) and vice versa (`removed`). Sorted for determinism. */
export function validationDelta(before: readonly Conflict[], after: readonly Conflict[]): ValidationDelta {
  const b = new Set<RuleCode>(before.map((c) => c.code));
  const a = new Set<RuleCode>(after.map((c) => c.code));
  return {
    added: [...a].filter((c) => !b.has(c)).sort(),
    removed: [...b].filter((c) => !a.has(c)).sort(),
  };
}

/**
 * "Introduces no new errors and does not worsen existing conflicts" (DESIGN §4.3/§6.3):
 * no error code may be added, and no warning code may be added (OVER_BUDGET excluded, as it is a goal
 * consequence the caller decides on). Info-level codes never block.
 */
export function isAcceptableChange(before: readonly Conflict[], after: readonly Conflict[]): boolean {
  const beforeCodes = new Set(before.map((c) => c.code));
  for (const c of after) {
    if (beforeCodes.has(c.code)) continue;
    if (c.severity === "error") return false;
    if (c.severity === "warning" && c.code !== "OVER_BUDGET") return false;
  }
  return true;
}
