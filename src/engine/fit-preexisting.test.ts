import { describe, expect, it } from "vitest";
import { SEED_CATALOG } from "../data/seed";
import { buildFromParts } from "./build";
import { fit } from "./fit";
import { indexCatalog } from "./types";

const catalog = indexCatalog(SEED_CATALOG);
const smallestPsu = [...catalog.byCategory.psu].sort((a, b) => a.wattage - b.wattage)[0];
const hungriestGpu = [...catalog.byCategory.gpu].sort((a, b) => b.tdpW - a.tdpW)[0];
const shortestCase = [...catalog.byCategory.case].sort((a, b) => a.maxGpuLengthMm - b.maxGpuLengthMm)[0];
const longestGpu = [...catalog.byCategory.gpu].sort((a, b) => b.lengthMm - a.lengthMm)[0];

describe("fit(): pre-existing failures caused by other slots do not block candidates", () => {
  it("a board already over its M.2 slot count does not mark a SATA drive incompatible", () => {
    const board = [...catalog.byCategory.motherboard].sort((a, b) => a.m2Slots - b.m2Slots)[0];
    const nvme = catalog.byCategory.storage.filter((d) => d.interface === "m2-nvme").slice(0, board.m2Slots + 1);
    const sata = catalog.byCategory.storage.find((d) => d.interface === "sata")!;
    const build = buildFromParts([board, ...nvme]);
    const r = fit(sata, build);
    expect(r.preexisting).toContain("M2_SLOTS_EXCEEDED");
    expect(r.fit).not.toBe("incompatible");
    expect(r.checks.find((c) => c.code === "M2_SLOTS_EXCEEDED")?.preexisting).toBe(true);
  });

  it("a rule the candidate's own category is needed for is not softened (no CPU can rescue an undersized PSU)", () => {
    const build = buildFromParts([smallestPsu, hungriestGpu]);
    const cpu = catalog.byCategory.cpu.find((c) => c.socket === "AM5")!;
    const r = fit(cpu, build);
    expect(r.checks.find((c) => c.code === "PSU_INSUFFICIENT")?.result).toBe("fail");
    expect(r.preexisting).not.toContain("PSU_INSUFFICIENT");
  });

  it("a too-long GPU candidate is still incompatible even when the current GPU is also too long", () => {
    const build = buildFromParts([shortestCase, longestGpu]);
    expect(longestGpu.lengthMm).toBeGreaterThan(shortestCase.maxGpuLengthMm);
    const r = fit(longestGpu, build);
    expect(r.fit).toBe("incompatible");
    expect(r.preexisting).not.toContain("GPU_TOO_LONG");
  });
});
