import { describe, expect, it } from "vitest";
import * as F from "./__fixtures__/parts";
import { buildFromParts, emptyBuild } from "./build";
import { compatibleParts, fit, rulesFor } from "./fit";

describe("fit (tri-state)", () => {
  it("is conditional on an empty build with pending codes", () => {
    const r = fit(F.gpu5090, emptyBuild());
    expect(r.fit).toBe("conditional");
    expect(r.pending).toContain("GPU_TOO_LONG");
    expect(r.checks.find((c) => c.code === "GPU_TOO_LONG")!.reason).toMatch(/no case selected yet — length unchecked/);
  });
  it("is incompatible when an error rule fails", () => {
    const r = fit(F.gpu5090, buildFromParts([F.caseItx15l]));
    expect(r.fit).toBe("incompatible");
    expect(r.checks.find((c) => c.code === "GPU_TOO_LONG")).toMatchObject({ result: "fail", reason: "GPU is 358 mm, case max 330 mm" });
  });
  it("is conditional while the PSU is missing (GPU load unchecked)", () => {
    const r = fit(F.gpu5070, buildFromParts([F.cpu9800x3d, F.caseMidAtxBlack]));
    expect(r.fit).toBe("conditional");
    expect(r.pending).toEqual(["PSU_INSUFFICIENT", "PSU_LOW_HEADROOM", "PCIE_GEN_MISMATCH"]);
  });
  it("is compatible when everything relevant passes", () => {
    const r = fit(F.gpu5070, buildFromParts(F.GOOD_PARTS));
    expect(r.fit).toBe("compatible");
    expect(r.pending).toEqual([]);
    expect(r.checks.every((c) => c.result !== "fail")).toBe(true);
  });
  it("evaluates the candidate as a replacement of the existing single-slot part", () => {
    // Current GPU fits; the 5090 would not fit the white glass case (355 mm) — replacement semantics.
    const b = buildFromParts([F.cpu9800x3d, F.mbX870eAtx, F.gpu5070ti, F.caseMidAtxWhiteGlass, F.psuAtx1000Gold]);
    expect(fit(F.gpu5090, b).fit).toBe("incompatible");
    expect(fit(F.gpu5070, b).fit).toBe("compatible");
  });
  it("evaluates multi-slot candidates as appended", () => {
    const b = buildFromParts([F.mbA620Matx, F.ssdNvmeGen4_1tb]);
    expect(fit(F.ssdNvmeGen4_2tb, b).fit).toBe("incompatible"); // 2 NVMe on a 1-slot board
    expect(fit(F.ssdSata1tb, b).fit).toBe("compatible");
  });
  it("a failing warning rule does not make the fit incompatible", () => {
    const r = fit(F.ramDdr5_8000_2x24, buildFromParts([F.mbB650Atx]));
    expect(r.fit).toBe("compatible");
    expect(r.checks.find((c) => c.code === "RAM_SPEED_LIMITED")!.result).toBe("fail");
  });
  it("only rules relevant to the category are reported", () => {
    const codesFor = rulesFor("gpu").map((r) => r.code);
    expect(codesFor).toContain("GPU_TOO_LONG");
    expect(codesFor).toContain("PSU_INSUFFICIENT");
    expect(codesFor).not.toContain("SOCKET_MISMATCH");
  });
});

describe("compatibleParts", () => {
  it("returns every catalog part in the category with a fit", () => {
    const res = compatibleParts("case", buildFromParts([F.mbB650Atx, F.gpu5090, F.coolerAir165, F.psuAtx1000Gold]), F.CATALOG);
    expect(res).toHaveLength(F.CATALOG.byCategory.case.length);
    const byId = Object.fromEntries(res.map((r) => [r.part.id, r.fit.fit]));
    expect(byId["case-mid-atx-black"]).toBe("compatible");
    expect(byId["case-itx-15l"]).toBe("incompatible");
    expect(byId["case-mid-atx-white-glass"]).toBe("incompatible"); // 358 mm GPU > 355 mm
  });
});
