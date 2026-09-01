import { describe, expect, it } from "vitest";
import * as F from "./__fixtures__/parts";
import { buildFromParts, withPart } from "./build";
import { alternatives, applicableDirections, utility, type AlternativesResult } from "./ranking";
import type { Category } from "../data/schema";
import { fit } from "./fit";
import type { Goal } from "./types";

const good = buildFromParts(F.GOOD_PARTS);
const ids = <C extends Category>(r: AlternativesResult<C>) => (r.ok ? r.candidates.map((c) => c.part.id) : r);

describe("utility", () => {
  it("uses the goal workload perf key for CPU/GPU", () => {
    const ml: Goal = { useCase: "ml", budgetUSD: 5000 };
    expect(utility(F.gpu5070ti)).toBe(9);
    expect(utility(F.gpu5070ti, ml)).toBe(7);
  });
  it("is deterministic per category", () => {
    expect(utility(F.ramDdr5_6000_2x16)).toBe(192);
    expect(utility(F.ssdNvmeGen4_2tb)).toBe(8);
    expect(utility(F.psuAtx1000Gold)).toBe(12);
    expect(utility(F.coolerAir165)).toBe(250);
    expect(utility(F.mbX870eAtx)).toBe(13);
    expect(utility(F.caseMidAtxBlack)).toBe(14.25);
  });
});

describe("alternatives", () => {
  it("cheaper: lower price first, only cheaper parts, no new errors", () => {
    const r = alternatives("gpu", good, F.CATALOG, { direction: "cheaper", count: 3 });
    expect(ids(r)).toEqual(["gpu-rx-7600", "gpu-rtx-4060", "gpu-rtx-5060"]);
    if (!r.ok) throw new Error();
    expect(r.candidates[0]!.priceDelta).toBe(-500);
    expect(r.candidates[0]!.validation).toEqual({ added: [], removed: [] });
    expect(r.candidates[0]!.tradeoff).toMatch(/\$500 cheaper; gaming1440p tier 9 → 5/);
    expect(r.candidates[0]!.specDelta["vramGB"]).toEqual({ from: 16, to: 8 });
  });
  it("cheaper: count is clamped to 6 and default is 3", () => {
    const all = alternatives("gpu", good, F.CATALOG, { direction: "cheaper", count: 20 });
    expect(all.ok && all.candidates.length).toBe(5);
    const def = alternatives("gpu", good, F.CATALOG, { direction: "cheaper" });
    expect(def.ok && def.candidates.length).toBe(3);
  });
  it("better: excludes candidates that introduce errors or new warnings (5090 overloads the PSU)", () => {
    expect(ids(alternatives("gpu", good, F.CATALOG, { direction: "better" }))).toEqual([]);
    // With a 1200 W PSU the 5090 fits (no error) but would add PSU_LOW_HEADROOM — still excluded.
    const withBigPsu = withPart(good, F.psuAtx1200Platinum, { replace: true });
    expect(fit(F.gpu5090, withBigPsu).fit).toBe("compatible");
    expect(ids(alternatives("gpu", withBigPsu, F.CATALOG, { direction: "better" }))).toEqual([]);
  });
  it("better: higher utility first, then price; socket-mismatched CPUs excluded", () => {
    const b = withPart(good, F.cpu9600x, { replace: true });
    expect(ids(alternatives("cpu", b, F.CATALOG, { direction: "better" }))).toEqual(["cpu-r7-9800x3d", "cpu-r9-9950x"]);
  });
  it("quieter: lower noiseTier only", () => {
    expect(ids(alternatives("gpu", good, F.CATALOG, { direction: "quieter" }))).toEqual(["gpu-rtx-4060"]);
    expect(ids(alternatives("psu", good, F.CATALOG, { direction: "quieter" }))).toEqual(["psu-atx-1200-platinum"]);
  });
  it("smaller: ascending size, candidates that break clearance excluded", () => {
    expect(ids(alternatives("case", good, F.CATALOG, { direction: "smaller" }))).toEqual(["case-mid-atx-white-glass", "case-mid-silent"]);
    expect(ids(alternatives("motherboard", good, F.CATALOG, { direction: "smaller" }))).toEqual(["mb-b850-itx", "mb-a620-matx"]);
  });
  it("no direction: closest price with utility >= current", () => {
    expect(ids(alternatives("storage", good, F.CATALOG))).toEqual(["ssd-nvme-gen5-2tb", "ssd-sata-4tb", "ssd-nvme-gen4-4tb"]);
  });
  it("inapplicable direction returns DIRECTION_NOT_APPLICABLE with the applicable list", () => {
    const r = alternatives("cpu", good, F.CATALOG, { direction: "quieter" });
    expect(r).toMatchObject({ ok: false, code: "DIRECTION_NOT_APPLICABLE", direction: "quieter", applicable: ["cheaper", "better"] });
    expect(applicableDirections("case")).toEqual(["cheaper", "better", "quieter", "smaller"]);
    expect(applicableDirections("ram")).toEqual(["cheaper", "better"]);
  });
  it("multi-slot: replaces the most expensive item by default, or the requested one", () => {
    const b = withPart(good, F.ssdNvmeGen4_1tb);
    const r = alternatives("storage", b, F.CATALOG, { direction: "cheaper" });
    expect(r.ok && r.current?.id).toBe("ssd-nvme-gen4-2tb");
    const r2 = alternatives("storage", b, F.CATALOG, { direction: "cheaper", currentPartId: "ssd-nvme-gen4-1tb" });
    expect(r2.ok && r2.current?.id).toBe("ssd-nvme-gen4-1tb");
    expect(ids(r2)).toEqual(["ssd-nvme-gen3-500gb", "ssd-sata-1tb"]);
  });
  it("empty slot: ranks against nothing; undersized/unsupported coolers excluded; id tie-break", () => {
    const r = alternatives("cooler", buildFromParts([F.cpu9800x3d, F.caseMidAtxBlack]), F.CATALOG, { direction: "cheaper", count: 2 });
    expect(ids(r)).toEqual(["cooler-tower-air-155", "cooler-aio-240"]);
  });
  it("is deterministic", () => {
    const a = alternatives("gpu", good, F.CATALOG, { direction: "cheaper", count: 6 });
    const b = alternatives("gpu", good, F.CATALOG, { direction: "cheaper", count: 6 });
    expect(a).toEqual(b);
  });
});
