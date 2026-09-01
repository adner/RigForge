import { describe, expect, it } from "vitest";
import * as F from "./__fixtures__/parts";
import { buildFromParts, emptyBuild } from "./build";
import { perfKeyFor, performance } from "./performance";

describe("performance", () => {
  it("maps workload + resolution to a perf key", () => {
    expect(perfKeyFor("gaming")).toBe("gaming1440p");
    expect(perfKeyFor("gaming", "1080p")).toBe("gaming1080p");
    expect(perfKeyFor("gaming", "4k")).toBe("gaming4k");
    expect(perfKeyFor("video-editing", "4k")).toBe("videoEditing");
    expect(perfKeyFor("3d-rendering")).toBe("rendering3d");
    expect(perfKeyFor("office")).toBe("office");
  });
  it("reports component tiers, bottleneck (min tier) and PSU load", () => {
    const r = performance(buildFromParts(F.GOOD_PARTS), "gaming", "4k");
    expect(r.perfKey).toBe("gaming4k");
    expect(r.components).toEqual([
      { category: "cpu", partId: "cpu-r7-9800x3d", tier: 9 },
      { category: "gpu", partId: "gpu-rtx-5070ti", tier: 8 },
    ]);
    expect(r.bottleneck).toEqual({ category: "gpu", partId: "gpu-rtx-5070ti", tier: 8 });
    expect(r.overallTier).toBe(8);
    expect(r.balanceNote).toMatch(/^balanced/);
    expect(r.psu).toEqual({ estWatts: 659, psuWattage: 1000, headroomPct: 34.1 });
    expect(r.editorial).toBe(true);
  });
  it("flags a CPU-limited pairing", () => {
    const r = performance(buildFromParts([F.cpu2600, F.gpu5090]), "gaming");
    expect(r.bottleneck?.category).toBe("cpu");
    expect(r.balanceNote).toMatch(/^CPU-limited: CPU tier 3 holds back GPU tier 10/);
  });
  it("handles partial and empty builds", () => {
    expect(performance(emptyBuild(), "ml").bottleneck).toBeUndefined();
    expect(performance(emptyBuild(), "ml").balanceNote).toMatch(/nothing to estimate/);
    const cpuOnly = performance(buildFromParts([F.cpu9800x3d]), "office");
    expect(cpuOnly.overallTier).toBe(9);
    expect(cpuOnly.balanceNote).toMatch(/integrated graphics/);
    expect(cpuOnly.psu.psuWattage).toBeUndefined();
  });
});
