import type { Part } from "../data/schema";
import { fit, isMultiSlot, partsIn, type Build, type Goal } from "../engine";

export interface PartSelectionIntent {
  replace: boolean;
  confirmation?: string;
}

/**
 * Describe the human's pending catalog selection against the latest build state.
 * Incompatible choices remain possible, but require an explicit acknowledgement
 * of the engine-computed blockers before they are committed.
 */
export function partSelectionIntent(part: Part, build: Build, goal?: Goal): PartSelectionIntent {
  const occupied = partsIn(build, part.category);
  const replace = occupied.length > 0 && !isMultiSlot(part.category);
  const blockers = fit(part, build, goal).checks.filter(
    (check) => check.severity === "error" && check.result === "fail" && !check.preexisting,
  );

  if (blockers.length > 0) {
    const action = replace ? "Swap anyway?" : "Add anyway?";
    const reasons = blockers.map((check) => `• ${check.reason}`).join("\n");
    return {
      replace,
      confirmation: `${part.name} won't fit the current build:\n\n${reasons}\n\n${action}`,
    };
  }

  if (replace) {
    return { replace, confirmation: `Replace ${occupied[0]!.name} with ${part.name}?` };
  }

  return { replace };
}
