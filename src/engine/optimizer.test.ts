import { describe, expect, it } from "vitest";
import * as F from "./__fixtures__/parts";
import { buildFromParts, withPart } from "./build";
import { defaultPreserve, fitToBudget, preserveLoss } from "./optimizer";
import type { Goal } from "./types";

const good = buildFromParts(F.GOOD_PARTS); // $2162
const goal: Goal = { useCase: "gaming", budgetUSD: 2500 };

describe("fitToBudget", () => {
  it("returns no ops when already within budget", () => {
    const r = fitToBudget(good, F.CATALOG, { budgetUSD: 2500 });
    expect(r).toMatchObject({ ok: true, ops: [], totalUSD: 2162, method: "none", swaps: 0, loss: 0 });
  });

  it("feasible: proposes swaps under budget with zero performance loss when possible (beam path)", () => {
    const r = fitToBudget(good, F.CATALOG, { budgetUSD: 1900, goal });
    if (!r.ok) throw new Error(r.message);
    expect(r.method).toBe("beam"); // 7 categories have cheaper candidates
    expect(r.totalUSD).toBeLessThanOrEqual(1900);
    expect(r.loss).toBe(0);
    expect(r.preserve).toBe("performance");
    expect(r.ops.length).toBeGreaterThan(0);
    expect(r.ops.every((op) => op.op === "replace" && op.savings > 0 && op.tradeoff.length > 0)).toBe(true);
    expect(r.validation.filter((c) => c.severity === "error")).toEqual([]);
    expect(r.delta.added.filter((c) => c !== "PCIE_GEN_MISMATCH")).toEqual([]);
    // ops ordered by category order
    const order = ["cpu", "motherboard", "ram", "gpu", "cooler", "case", "psu", "storage"];
    const idx = r.ops.map((op) => order.indexOf(op.category));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("exhaustive path when protected categories bring the search to <= 5", () => {
    const r = fitToBudget(good, F.CATALOG, { budgetUSD: 1900, goal, protect: ["cpu", "gpu", "case"] });
    if (!r.ok) throw new Error(r.message);
    expect(r.method).toBe("exhaustive");
    expect(r.totalUSD).toBeLessThanOrEqual(1900);
    expect(r.ops.every((op) => !["cpu", "gpu", "case"].includes(op.category))).toBe(true);
  });

  it("accepts performance loss only when the budget forces it, and prefers fewer swaps", () => {
    const r = fitToBudget(good, F.CATALOG, { budgetUSD: 1400, goal });
    if (!r.ok) throw new Error(r.message);
    expect(r.totalUSD).toBeLessThanOrEqual(1400);
    expect(r.loss).toBeGreaterThan(0);
    expect(r.ops.some((op) => op.category === "gpu" || op.category === "cpu")).toBe(true);
  });

  it("infeasible: reports cheapest total and protected categories", () => {
    const r = fitToBudget(good, F.CATALOG, { budgetUSD: 500, goal });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error();
    expect(r.code).toBe("BUDGET_INFEASIBLE");
    expect(r.cheapestTotal).toBeGreaterThan(500);
    expect(r.blockedBy).toEqual([]);
    const p = fitToBudget(good, F.CATALOG, { budgetUSD: 1900, goal, protect: ["cpu", "motherboard", "ram", "gpu", "cooler", "case", "psu"] });
    expect(p).toMatchObject({ ok: false, code: "BUDGET_INFEASIBLE", blockedBy: ["cpu", "motherboard", "ram", "gpu", "cooler", "case", "psu"] });
    if (p.ok) throw new Error();
    expect(p.cheapestTotal).toBe(2162 - 139 + 45); // only the storage slot could change
  });

  it("protected categories are immutable", () => {
    const r = fitToBudget(good, F.CATALOG, { budgetUSD: 1900, goal, protect: ["gpu", "cpu"] });
    if (!r.ok) throw new Error(r.message);
    expect(r.ops.every((op) => op.category !== "gpu" && op.category !== "cpu")).toBe(true);
  });

  it("multi-slot: only the most expensive drive is a swap candidate; other items kept", () => {
    const b = withPart(good, F.ssdNvmeGen4_1tb); // $2241
    const r = fitToBudget(b, F.CATALOG, { budgetUSD: 2200, goal });
    if (!r.ok) throw new Error(r.message);
    // Single swap, zero perf loss, highest retained utility: the cheaper tower cooler (same TDP rating).
    expect(r.ops).toEqual([
      expect.objectContaining({ op: "replace", category: "cooler", fromPartId: "cooler-tower-air-165", toPartId: "cooler-tower-air-155", savings: 60 }),
    ]);
    expect(r.totalUSD).toBe(2181);
    const storageOnly = fitToBudget(b, F.CATALOG, { budgetUSD: 2200, goal, protect: ["cpu", "motherboard", "ram", "gpu", "cooler", "case", "psu"] });
    if (!storageOnly.ok) throw new Error(storageOnly.message);
    expect(storageOnly.ops).toHaveLength(1);
    expect(storageOnly.ops[0]!.fromPartId).toBe("ssd-nvme-gen4-2tb");
  });

  it("preserve=noise minimizes noise increase; default preserve follows the goal", () => {
    expect(defaultPreserve({ useCase: "gaming", budgetUSD: 1, preferences: { noise: "quiet" } })).toBe("noise");
    expect(defaultPreserve({ useCase: "gaming", budgetUSD: 1, preferences: { size: "compact" } })).toBe("size");
    expect(defaultPreserve()).toBe("performance");
    expect(preserveLoss("noise", F.coolerAir165, F.coolerAir155)).toBe(1);
    expect(preserveLoss("performance", F.gpu5070ti, F.gpu5070, goal)).toBe(2);
    expect(preserveLoss("performance", F.cpu9800x3d, F.cpu9600x, goal)).toBe(3);
    expect(preserveLoss("size", F.caseMidAtxBlack, F.caseFullTower60l)).toBe(22);
    const r = fitToBudget(good, F.CATALOG, { budgetUSD: 2110, goal, preserve: "noise" });
    if (!r.ok) throw new Error(r.message);
    expect(r.preserve).toBe("noise");
    expect(r.loss).toBe(0);
    expect(r.ops.every((op) => op.toPartId !== "cooler-tower-air-155")).toBe(true);
  });

  it("is deterministic (run twice, deep-equal)", () => {
    const a = fitToBudget(good, F.CATALOG, { budgetUSD: 1700, goal });
    const b = fitToBudget(good, F.CATALOG, { budgetUSD: 1700, goal });
    expect(a).toEqual(b);
    const c = fitToBudget(good, F.CATALOG, { budgetUSD: 1900, goal, protect: ["cpu"] });
    const d = fitToBudget(good, F.CATALOG, { budgetUSD: 1900, goal, protect: ["cpu"] });
    expect(c).toEqual(d);
  });
});
