import { describe, expect, it } from "vitest";
import { parsePart } from "../data/schema";
import * as F from "./__fixtures__/parts";
import { buildFromParts, buildTotalUSD, withPart, withoutPart, SlotOccupiedError } from "./build";
import { RULES, evaluateAll } from "./rules";
import { RULE_CODES, type Goal, type RuleCode } from "./types";
import { countConflicts, estimateWattage, psuHeadroomPct, validate, validationDelta, isAcceptableChange } from "./validate";

const codes = (b: ReturnType<typeof buildFromParts>, goal?: Goal) => validate(b, goal).map((c) => c.code);

describe("fixtures", () => {
  it("every fixture part passes the frozen schema", () => {
    for (const p of F.FIXTURE_PARTS) expect(() => parsePart(p)).not.toThrow();
    expect(new Set(F.FIXTURE_PARTS.map((p) => p.id)).size).toBe(F.FIXTURE_PARTS.length);
  });
  it("rules cover every rule code exactly once", () => {
    expect(RULES.map((r) => r.code).sort()).toEqual([...RULE_CODES].sort());
  });
});

describe("build helpers", () => {
  it("single-slot add throws SLOT_OCCUPIED unless replace", () => {
    const b = buildFromParts([F.cpu9800x3d]);
    expect(() => withPart(b, F.cpu9600x)).toThrow(SlotOccupiedError);
    expect(withPart(b, F.cpu9600x, { replace: true }).slots.cpu?.[0]?.id).toBe("cpu-r5-9600x");
  });
  it("multi-slot appends and can swap a specific item", () => {
    let b = buildFromParts([F.ssdNvmeGen4_1tb, F.ssdNvmeGen4_2tb]);
    expect(b.slots.storage).toHaveLength(2);
    b = withPart(b, F.ssdSata1tb, { replacesPartId: "ssd-nvme-gen4-1tb" });
    expect(b.slots.storage?.map((p) => p.id)).toEqual(["ssd-sata-1tb", "ssd-nvme-gen4-2tb"]);
    b = withoutPart(b, "ssd-sata-1tb");
    expect(b.slots.storage?.map((p) => p.id)).toEqual(["ssd-nvme-gen4-2tb"]);
    expect(withoutPart(b, "ssd-nvme-gen4-2tb").slots.storage).toBeUndefined();
  });
});

describe("wattage model", () => {
  it("matches DESIGN §5 for the good build", () => {
    const b = buildFromParts(F.GOOD_PARTS);
    // 120*1.2 + 300*1.4 + 2*5 + 1*5 + 30 + 50
    expect(estimateWattage(b)).toBe(144 + 420 + 10 + 5 + 30 + 50);
    expect(psuHeadroomPct(b)).toBe(34.1);
    expect(buildTotalUSD(b)).toBe(2162);
  });
  it("headroom is undefined without a PSU", () => {
    expect(psuHeadroomPct(buildFromParts([F.cpu9800x3d]))).toBeUndefined();
  });
});

describe("validate — good and incomplete builds", () => {
  it("good build triggers nothing", () => {
    expect(validate(buildFromParts(F.GOOD_PARTS))).toEqual([]);
  });
  it("good build with a matching goal triggers nothing", () => {
    const goal: Goal = { useCase: "gaming", budgetUSD: 2500, preferences: { noise: "quiet", size: "standard" } };
    expect(validate(buildFromParts(F.GOOD_PARTS), goal)).toEqual([]);
  });
  it("incomplete build reports unknown for rules needing empty slots and no conflicts for them", () => {
    const b = buildFromParts([F.gpu5090]);
    const results = evaluateAll({ build: b });
    const gpuLen = results.find((r) => r.code === "GPU_TOO_LONG")!;
    expect(gpuLen.result).toBe("unknown");
    expect(gpuLen.reason).toMatch(/no case selected yet/);
    expect(codes(b)).toEqual([]);
  });
});

describe("validate — one failing build per rule code", () => {
  const cases: Record<RuleCode, { parts: Parameters<typeof buildFromParts>[0]; goal?: Goal; explain: RegExp }> = {
    SOCKET_MISMATCH: { parts: [F.cpu265k, F.mbB650Atx], explain: /LGA1851.*AM5/ },
    CHIPSET_UNSUPPORTED: { parts: [F.cpu2600, F.mbB550Matx], explain: /B550 supports Zen 3, Zen 2 CPUs, not Zen\+/ },
    RAM_TYPE_MISMATCH: { parts: [F.ramDdr4_3200_2x16, F.mbB650Atx], explain: /DDR5.*DDR4/ },
    RAM_SLOTS_EXCEEDED: { parts: [F.ramDdr5_5600_4x16, F.mbB850Itx], explain: /4 RAM sticks.*2 slots/ },
    RAM_SPEED_LIMITED: { parts: [F.ramDdr5_8000_2x24, F.mbB650Atx], explain: /8000 MHz.*7200 MHz/ },
    FORM_FACTOR_MISMATCH: { parts: [F.mbB650Atx, F.caseItx15l], explain: /ATX.*supports ITX/ },
    GPU_TOO_LONG: { parts: [F.gpu5090, F.caseItx15l], explain: /GPU is 358 mm, case max 330 mm/ },
    COOLER_TOO_TALL: { parts: [F.coolerAir165, F.caseItx15l], explain: /165 mm tall, case max 70 mm/ },
    COOLER_SOCKET_UNSUPPORTED: { parts: [F.coolerAirLgaOnly, F.cpu9800x3d], explain: /LGA1851\/LGA1700, CPU is AM5/ },
    RADIATOR_UNSUPPORTED: { parts: [F.coolerAio360, F.caseItx15l], explain: /360 mm, case supports 240 mm/ },
    COOLER_UNDERSIZED: { parts: [F.coolerLowProfile47, F.cpu9950x], explain: /95 W, CPU TDP is 170 W/ },
    PSU_INSUFFICIENT: { parts: [F.cpu9800x3d, F.gpu5090, F.psuAtx650Gold], explain: /999 W exceeds PSU rating of 650 W/ },
    PSU_LOW_HEADROOM: { parts: [F.cpu9800x3d, F.gpu5090, F.psuAtx1200Platinum], explain: /headroom is 16.8%/ },
    PSU_FORM_FACTOR: { parts: [F.psuAtx650Gold, F.caseItx15l], explain: /PSU is ATX, case accepts SFX\/SFX-L/ },
    NO_IGPU_NO_GPU: { parts: [F.cpu5700x], explain: /no integrated graphics/ },
    M2_SLOTS_EXCEEDED: { parts: [F.mbA620Matx, F.ssdNvmeGen4_1tb, F.ssdNvmeGen4_2tb], explain: /2 NVMe drives.*1 M.2 slots/ },
    SATA_PORTS_EXCEEDED: { parts: [F.mbB850Itx, F.ssdSata1tb, F.ssdSata2tb, F.ssdSata4tb], explain: /3 SATA drives.*2 SATA ports/ },
    PCIE_GEN_MISMATCH: { parts: [F.mbB650Atx, F.gpu5070ti], explain: /GPU is PCIe Gen 5, motherboard is Gen 4/ },
    COOLER_MISSING: { parts: [F.cpu9800x3d], explain: /does not include a cooler/ },
    OVER_BUDGET: { parts: F.GOOD_PARTS, goal: { useCase: "gaming", budgetUSD: 2000 }, explain: /\$2162 exceeds budget of \$2000 by \$162/ },
    GOAL_SLOT_MISSING: { parts: [F.cpu9800x3d], goal: { useCase: "gaming", budgetUSD: 2000 }, explain: /still needs: motherboard, RAM, storage, PSU, case, GPU/ },
    TIER_IMBALANCE: { parts: [F.cpu2600, F.gpu5090], goal: { useCase: "gaming", budgetUSD: 5000 }, explain: /CPU is tier 3 and GPU is tier 10/ },
    GOAL_NOISE: { parts: [F.gpu7600], goal: { useCase: "gaming", budgetUSD: 5000, preferences: { noise: "quiet" } }, explain: /GPU is noise tier 4/ },
    GOAL_SIZE: { parts: [F.caseMidAtxBlack], goal: { useCase: "gaming", budgetUSD: 5000, preferences: { size: "compact" } }, explain: /40 L \(over 25 L\)/ },
  };

  for (const code of RULE_CODES) {
    it(code, () => {
      const { parts, goal, explain } = cases[code];
      const conflicts = validate(buildFromParts(parts), goal);
      const hit = conflicts.find((c) => c.code === code);
      expect(hit, `expected ${code} in ${conflicts.map((c) => c.code).join(",")}`).toBeDefined();
      expect(hit!.explanation).toMatch(explain);
      expect(hit!.severity).toBe(RULES.find((r) => r.code === code)!.severity);
    });
  }

  it("CHIPSET_UNSUPPORTED is not_applicable when the socket already mismatches", () => {
    const r = evaluateAll({ build: buildFromParts([F.cpu265k, F.mbB650Atx]) }).find((x) => x.code === "CHIPSET_UNSUPPORTED")!;
    expect(r.result).toBe("not_applicable");
  });
  it("PSU_LOW_HEADROOM is superseded when the PSU is insufficient", () => {
    const r = evaluateAll({ build: buildFromParts([F.cpu9800x3d, F.gpu5090, F.psuAtx650Gold]) }).find((x) => x.code === "PSU_LOW_HEADROOM")!;
    expect(r.result).toBe("not_applicable");
  });
  it("goal rules are not_applicable without a goal", () => {
    const r = evaluateAll({ build: buildFromParts(F.GOOD_PARTS) }).filter((x) => x.code.startsWith("GOAL_") || x.code === "OVER_BUDGET");
    expect(r.every((x) => x.result === "not_applicable")).toBe(true);
  });
});

describe("validation delta", () => {
  it("computes added/removed codes and counts", () => {
    const before = validate(buildFromParts([F.cpu9800x3d, F.mbB650Atx, F.gpu5070ti]));
    const after = validate(buildFromParts([F.cpu9800x3d, F.mbX870eAtx, F.gpu5070ti, F.coolerAir165]));
    expect(validationDelta(before, after)).toEqual({ added: [], removed: ["COOLER_MISSING", "PCIE_GEN_MISMATCH"] });
    expect(countConflicts(before)).toEqual({ errors: 0, warnings: 1, info: 1 });
    expect(isAcceptableChange(before, after)).toBe(true);
    expect(isAcceptableChange(after, before)).toBe(false);
  });
  it("new OVER_BUDGET warning and new info never block a change", () => {
    const before = validate(buildFromParts(F.GOOD_PARTS), { useCase: "gaming", budgetUSD: 2200 });
    const after = validate(buildFromParts(F.GOOD_PARTS), { useCase: "gaming", budgetUSD: 2000 });
    expect(after.map((c) => c.code)).toEqual(["OVER_BUDGET"]);
    expect(isAcceptableChange(before, after)).toBe(true);
  });
});
