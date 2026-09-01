/**
 * Compatibility rules v1 (DESIGN §5). Each rule declares the slots it needs; if one is empty the
 * rule reports `unknown` (this feeds the tri-state `fit`). Goal rules report `not_applicable` without a goal.
 */
import { CATEGORIES, CHIPSET_SUPPORT, type Category, type Part } from "../data/schema";
import { partsIn, single, buildTotalUSD } from "./build";
import { estimateWattage, psuHeadroomPct } from "./power";
import type { Build, Goal, RuleCode, RuleResult, RuleResultKind, Severity, Workload } from "./types";
import type { PerfKey } from "../data/schema";

export interface RuleContext {
  build: Build;
  goal?: Goal;
}

export interface RuleOutcome {
  result: RuleResultKind;
  reason: string;
  partIds?: string[];
}

export interface Rule {
  code: RuleCode;
  severity: Severity;
  /** Slots that must be filled before the rule can be evaluated. */
  needs: readonly Category[];
  /** Additional slots the rule looks at when present (used by `fit` to select relevant rules). */
  involves: readonly Category[];
  /** Requires a goal; without one the rule is `not_applicable`. */
  goal?: boolean;
  evaluate(ctx: RuleContext): RuleOutcome;
}

const pass = (reason: string, partIds?: string[]): RuleOutcome => ({ result: "pass", reason, partIds });
const fail = (reason: string, partIds: string[]): RuleOutcome => ({ result: "fail", reason, partIds });
const na = (reason: string): RuleOutcome => ({ result: "not_applicable", reason });
const unknown = (reason: string): RuleOutcome => ({ result: "unknown", reason });

export const LABEL: Record<Category, string> = {
  cpu: "CPU",
  motherboard: "motherboard",
  ram: "RAM",
  gpu: "GPU",
  cooler: "cooler",
  case: "case",
  psu: "PSU",
  storage: "storage",
};

/** Default perf key per workload (gaming defaults to 1440p; see performance.ts for resolution handling). */
export const PERF_KEY_BY_WORKLOAD: Record<Workload, PerfKey> = {
  gaming: "gaming1440p",
  streaming: "streaming",
  "video-editing": "videoEditing",
  "3d-rendering": "rendering3d",
  ml: "ml",
  office: "office",
};

/** Slots a goal expects to be filled for a complete build. */
export function goalRequiredSlots(useCase: Workload): Category[] {
  const base: Category[] = ["cpu", "motherboard", "ram", "storage", "psu", "case"];
  return useCase === "office" ? base : [...base, "gpu"];
}

const money = (n: number) => `$${Math.round(n * 100) / 100}`;

export const RULES: readonly Rule[] = [
  {
    code: "SOCKET_MISMATCH",
    severity: "error",
    needs: ["cpu", "motherboard"],
    involves: [],
    evaluate({ build }) {
      const cpu = single(build, "cpu")!;
      const mb = single(build, "motherboard")!;
      return cpu.socket === mb.socket
        ? pass(`CPU and motherboard both use ${cpu.socket}`, [cpu.id, mb.id])
        : fail(`CPU socket is ${cpu.socket}, motherboard socket is ${mb.socket}`, [cpu.id, mb.id]);
    },
  },
  {
    code: "CHIPSET_UNSUPPORTED",
    severity: "error",
    needs: ["cpu", "motherboard"],
    involves: [],
    evaluate({ build }) {
      const cpu = single(build, "cpu")!;
      const mb = single(build, "motherboard")!;
      if (cpu.socket !== mb.socket) return na("socket mismatch takes precedence");
      const supported = CHIPSET_SUPPORT[mb.chipset];
      if (!supported) return pass(`chipset ${mb.chipset} has no support table entry; assumed compatible`, [cpu.id, mb.id]);
      return supported.includes(cpu.generation)
        ? pass(`${mb.chipset} supports ${cpu.generation} CPUs`, [cpu.id, mb.id])
        : fail(`${mb.chipset} supports ${supported.join(", ")} CPUs, not ${cpu.generation}`, [cpu.id, mb.id]);
    },
  },
  {
    code: "RAM_TYPE_MISMATCH",
    severity: "error",
    needs: ["ram", "motherboard"],
    involves: [],
    evaluate({ build }) {
      const mb = single(build, "motherboard")!;
      const bad = partsIn(build, "ram").filter((r) => r.ddrGen !== mb.ddrGen);
      return bad.length
        ? fail(`motherboard takes DDR${mb.ddrGen}, kit is DDR${bad[0]!.ddrGen}`, [mb.id, ...bad.map((r) => r.id)])
        : pass(`all RAM is DDR${mb.ddrGen}, matching the motherboard`, [mb.id]);
    },
  },
  {
    code: "RAM_SLOTS_EXCEEDED",
    severity: "error",
    needs: ["ram", "motherboard"],
    involves: [],
    evaluate({ build }) {
      const mb = single(build, "motherboard")!;
      const ram = partsIn(build, "ram");
      const sticks = ram.reduce((s, r) => s + r.sticks, 0);
      const ids = [mb.id, ...ram.map((r) => r.id)];
      return sticks > mb.ramSlots
        ? fail(`${sticks} RAM sticks selected, motherboard has ${mb.ramSlots} slots`, ids)
        : pass(`${sticks} of ${mb.ramSlots} RAM slots used`, ids);
    },
  },
  {
    code: "RAM_SPEED_LIMITED",
    severity: "warning",
    needs: ["ram", "motherboard"],
    involves: [],
    evaluate({ build }) {
      const mb = single(build, "motherboard")!;
      const fast = partsIn(build, "ram").filter((r) => r.speedMHz > mb.maxRamSpeedMHz);
      return fast.length
        ? fail(
            `RAM is rated ${fast[0]!.speedMHz} MHz, motherboard max is ${mb.maxRamSpeedMHz} MHz (will downclock)`,
            [mb.id, ...fast.map((r) => r.id)],
          )
        : pass(`RAM speed within motherboard max of ${mb.maxRamSpeedMHz} MHz`, [mb.id]);
    },
  },
  {
    code: "FORM_FACTOR_MISMATCH",
    severity: "error",
    needs: ["motherboard", "case"],
    involves: [],
    evaluate({ build }) {
      const mb = single(build, "motherboard")!;
      const cs = single(build, "case")!;
      return cs.formFactorSupport.includes(mb.formFactor)
        ? pass(`case supports ${mb.formFactor} motherboards`, [mb.id, cs.id])
        : fail(`motherboard is ${mb.formFactor}, case supports ${cs.formFactorSupport.join("/")}`, [mb.id, cs.id]);
    },
  },
  {
    code: "GPU_TOO_LONG",
    severity: "error",
    needs: ["gpu", "case"],
    involves: [],
    evaluate({ build }) {
      const gpu = single(build, "gpu")!;
      const cs = single(build, "case")!;
      return gpu.lengthMm > cs.maxGpuLengthMm
        ? fail(`GPU is ${gpu.lengthMm} mm, case max ${cs.maxGpuLengthMm} mm`, [gpu.id, cs.id])
        : pass(`GPU is ${gpu.lengthMm} mm, case allows ${cs.maxGpuLengthMm} mm`, [gpu.id, cs.id]);
    },
  },
  {
    code: "COOLER_TOO_TALL",
    severity: "error",
    needs: ["cooler", "case"],
    involves: [],
    evaluate({ build }) {
      const cooler = single(build, "cooler")!;
      const cs = single(build, "case")!;
      if (cooler.type !== "air" || cooler.heightMm == null) return na("AIO cooler; height limit does not apply");
      return cooler.heightMm > cs.maxCoolerHeightMm
        ? fail(`cooler is ${cooler.heightMm} mm tall, case max ${cs.maxCoolerHeightMm} mm`, [cooler.id, cs.id])
        : pass(`cooler is ${cooler.heightMm} mm tall, case allows ${cs.maxCoolerHeightMm} mm`, [cooler.id, cs.id]);
    },
  },
  {
    code: "COOLER_SOCKET_UNSUPPORTED",
    severity: "error",
    needs: ["cooler", "cpu"],
    involves: [],
    evaluate({ build }) {
      const cooler = single(build, "cooler")!;
      const cpu = single(build, "cpu")!;
      return cooler.socketSupport.includes(cpu.socket)
        ? pass(`cooler supports ${cpu.socket}`, [cooler.id, cpu.id])
        : fail(`cooler supports ${cooler.socketSupport.join("/")}, CPU is ${cpu.socket}`, [cooler.id, cpu.id]);
    },
  },
  {
    code: "RADIATOR_UNSUPPORTED",
    severity: "error",
    needs: ["cooler", "case"],
    involves: [],
    evaluate({ build }) {
      const cooler = single(build, "cooler")!;
      const cs = single(build, "case")!;
      if (cooler.type !== "aio" || cooler.radiatorMm == null) return na("air cooler; no radiator");
      const supported = cs.radiatorSupport.length ? `${cs.radiatorSupport.join("/")} mm` : "no radiators";
      return cs.radiatorSupport.includes(cooler.radiatorMm)
        ? pass(`case supports a ${cooler.radiatorMm} mm radiator`, [cooler.id, cs.id])
        : fail(`AIO radiator is ${cooler.radiatorMm} mm, case supports ${supported}`, [cooler.id, cs.id]);
    },
  },
  {
    code: "COOLER_UNDERSIZED",
    severity: "warning",
    needs: ["cooler", "cpu"],
    involves: [],
    evaluate({ build }) {
      const cooler = single(build, "cooler")!;
      const cpu = single(build, "cpu")!;
      return cooler.tdpRatingW < cpu.tdpW
        ? fail(`cooler is rated for ${cooler.tdpRatingW} W, CPU TDP is ${cpu.tdpW} W`, [cooler.id, cpu.id])
        : pass(`cooler rated ${cooler.tdpRatingW} W covers CPU TDP of ${cpu.tdpW} W`, [cooler.id, cpu.id]);
    },
  },
  {
    code: "PSU_INSUFFICIENT",
    severity: "error",
    needs: ["psu", "cpu"],
    involves: ["gpu"],
    evaluate({ build }) {
      const psu = single(build, "psu")!;
      const cpu = single(build, "cpu")!;
      const gpu = single(build, "gpu");
      if (!gpu && !cpu.hasIgpu) return unknown("no GPU selected yet — load estimate incomplete");
      const load = estimateWattage(build);
      const ids = [psu.id, cpu.id, ...(gpu ? [gpu.id] : [])];
      return load > psu.wattage
        ? fail(`estimated load ${load} W exceeds PSU rating of ${psu.wattage} W`, ids)
        : pass(`estimated load ${load} W within PSU rating of ${psu.wattage} W`, ids);
    },
  },
  {
    code: "PSU_LOW_HEADROOM",
    severity: "warning",
    needs: ["psu", "cpu"],
    involves: ["gpu"],
    evaluate({ build }) {
      const psu = single(build, "psu")!;
      const cpu = single(build, "cpu")!;
      const gpu = single(build, "gpu");
      if (!gpu && !cpu.hasIgpu) return unknown("no GPU selected yet — load estimate incomplete");
      const load = estimateWattage(build);
      if (load > psu.wattage) return na("PSU is insufficient; headroom check superseded");
      const pct = psuHeadroomPct(build)!;
      const ids = [psu.id, cpu.id, ...(gpu ? [gpu.id] : [])];
      return pct < 20
        ? fail(`PSU headroom is ${pct}% (${load} W of ${psu.wattage} W), under 20%`, ids)
        : pass(`PSU headroom is ${pct}% (${load} W of ${psu.wattage} W)`, ids);
    },
  },
  {
    code: "PSU_FORM_FACTOR",
    severity: "error",
    needs: ["psu", "case"],
    involves: [],
    evaluate({ build }) {
      const psu = single(build, "psu")!;
      const cs = single(build, "case")!;
      return cs.psuFormFactor.includes(psu.formFactor)
        ? pass(`case accepts ${psu.formFactor} power supplies`, [psu.id, cs.id])
        : fail(`PSU is ${psu.formFactor}, case accepts ${cs.psuFormFactor.join("/")}`, [psu.id, cs.id]);
    },
  },
  {
    code: "NO_IGPU_NO_GPU",
    severity: "error",
    needs: ["cpu"],
    involves: ["gpu"],
    evaluate({ build }) {
      const cpu = single(build, "cpu")!;
      const gpu = single(build, "gpu");
      if (gpu) return pass("discrete GPU present", [cpu.id, gpu.id]);
      return cpu.hasIgpu
        ? pass("CPU has integrated graphics", [cpu.id])
        : fail("CPU has no integrated graphics and no discrete GPU is selected", [cpu.id]);
    },
  },
  {
    code: "M2_SLOTS_EXCEEDED",
    severity: "error",
    needs: ["motherboard"],
    involves: ["storage"],
    evaluate({ build }) {
      const mb = single(build, "motherboard")!;
      const storage = partsIn(build, "storage");
      if (!storage.length) return na("no storage selected");
      const nvme = storage.filter((s) => s.interface === "m2-nvme");
      const ids = [mb.id, ...nvme.map((s) => s.id)];
      return nvme.length > mb.m2Slots
        ? fail(`${nvme.length} NVMe drives selected, motherboard has ${mb.m2Slots} M.2 slots`, ids)
        : pass(`${nvme.length} of ${mb.m2Slots} M.2 slots used`, ids);
    },
  },
  {
    code: "SATA_PORTS_EXCEEDED",
    severity: "error",
    needs: ["motherboard"],
    involves: ["storage"],
    evaluate({ build }) {
      const mb = single(build, "motherboard")!;
      const storage = partsIn(build, "storage");
      if (!storage.length) return na("no storage selected");
      const sata = storage.filter((s) => s.interface === "sata");
      const ids = [mb.id, ...sata.map((s) => s.id)];
      return sata.length > mb.sataPorts
        ? fail(`${sata.length} SATA drives selected, motherboard has ${mb.sataPorts} SATA ports`, ids)
        : pass(`${sata.length} of ${mb.sataPorts} SATA ports used`, ids);
    },
  },
  {
    code: "PCIE_GEN_MISMATCH",
    severity: "info",
    needs: ["motherboard"],
    involves: ["gpu", "storage"],
    evaluate({ build }) {
      const mb = single(build, "motherboard")!;
      const gpu = single(build, "gpu");
      const nvme = partsIn(build, "storage").filter((s) => s.interface === "m2-nvme" && s.pcieGen != null);
      if (!gpu && !nvme.length) return na("no PCIe devices selected");
      const above: { part: Part; gen: number }[] = [];
      if (gpu && gpu.pcieGen > mb.pcieGen) above.push({ part: gpu, gen: gpu.pcieGen });
      for (const s of nvme) if (s.pcieGen! > mb.pcieGen) above.push({ part: s, gen: s.pcieGen! });
      if (!above.length) return pass(`all PCIe devices at or below the motherboard's Gen ${mb.pcieGen}`, [mb.id]);
      const first = above[0]!;
      return fail(
        `${LABEL[first.part.category]} is PCIe Gen ${first.gen}, motherboard is Gen ${mb.pcieGen} (runs at the lower generation)`,
        [mb.id, ...above.map((a) => a.part.id)],
      );
    },
  },
  {
    code: "COOLER_MISSING",
    severity: "warning",
    needs: ["cpu"],
    involves: ["cooler"],
    evaluate({ build }) {
      const cpu = single(build, "cpu")!;
      const cooler = single(build, "cooler");
      if (cooler) return pass("CPU cooler selected", [cpu.id, cooler.id]);
      return cpu.includesCooler
        ? pass("CPU ships with a stock cooler", [cpu.id])
        : fail("CPU does not include a cooler and none is selected", [cpu.id]);
    },
  },
  {
    code: "OVER_BUDGET",
    severity: "warning",
    needs: [],
    involves: [...CATEGORIES],
    goal: true,
    evaluate({ build, goal }) {
      const total = buildTotalUSD(build);
      const budget = goal!.budgetUSD;
      return total > budget
        ? fail(`build total ${money(total)} exceeds budget of ${money(budget)} by ${money(total - budget)}`, [])
        : pass(`build total ${money(total)} within budget of ${money(budget)}`);
    },
  },
  {
    code: "GOAL_SLOT_MISSING",
    severity: "info",
    needs: [],
    involves: [...CATEGORIES],
    goal: true,
    evaluate({ build, goal }) {
      const missing = goalRequiredSlots(goal!.useCase).filter((c) => !(build.slots[c]?.length ?? 0));
      return missing.length
        ? fail(`${goal!.useCase} build still needs: ${missing.map((c) => LABEL[c]).join(", ")}`, [])
        : pass(`all slots a ${goal!.useCase} build needs are filled`);
    },
  },
  {
    code: "TIER_IMBALANCE",
    severity: "info",
    needs: ["cpu", "gpu"],
    involves: [],
    goal: true,
    evaluate({ build, goal }) {
      const cpu = single(build, "cpu")!;
      const gpu = single(build, "gpu")!;
      const key = PERF_KEY_BY_WORKLOAD[goal!.useCase];
      const c = cpu.perfTier[key];
      const g = gpu.perfTier[key];
      const ids = [cpu.id, gpu.id];
      if (Math.abs(c - g) >= 4) {
        const low = c < g ? "CPU" : "GPU";
        return fail(`for ${goal!.useCase}, CPU is tier ${c} and GPU is tier ${g}; the ${low} will hold the other back`, ids);
      }
      return pass(`for ${goal!.useCase}, CPU tier ${c} and GPU tier ${g} are balanced`, ids);
    },
  },
  {
    code: "GOAL_NOISE",
    severity: "info",
    needs: [],
    involves: ["gpu", "cooler", "case", "psu"],
    goal: true,
    evaluate({ build, goal }) {
      if (goal!.preferences?.noise !== "quiet") return na("no quiet preference set");
      const loud: { id: string; label: string; tier: number }[] = [];
      for (const c of ["gpu", "cooler", "case", "psu"] as const) {
        const p = single(build, c);
        if (p && p.noiseTier >= 4) loud.push({ id: p.id, label: LABEL[c], tier: p.noiseTier });
      }
      if (!loud.length) return pass("no part has noise tier 4 or higher");
      return fail(
        `quiet build requested, but ${loud.map((l) => `${l.label} is noise tier ${l.tier}`).join(", ")}`,
        loud.map((l) => l.id),
      );
    },
  },
  {
    code: "GOAL_SIZE",
    severity: "info",
    needs: ["case"],
    involves: [],
    goal: true,
    evaluate({ build, goal }) {
      if (goal!.preferences?.size !== "compact") return na("no compact preference set");
      const cs = single(build, "case")!;
      return cs.volumeLiters > 25
        ? fail(`compact build requested, but case is ${cs.volumeLiters} L (over 25 L)`, [cs.id])
        : pass(`case is ${cs.volumeLiters} L, within the 25 L compact limit`, [cs.id]);
    },
  },
];

export const RULE_BY_CODE: ReadonlyMap<RuleCode, Rule> = new Map(RULES.map((r) => [r.code, r]));

const UNCHECKED_ASPECT: Partial<Record<RuleCode, string>> = {
  GPU_TOO_LONG: "length",
  COOLER_TOO_TALL: "height",
  RADIATOR_UNSUPPORTED: "radiator fit",
  SOCKET_MISMATCH: "socket",
  COOLER_SOCKET_UNSUPPORTED: "socket",
  CHIPSET_UNSUPPORTED: "chipset support",
  RAM_TYPE_MISMATCH: "DDR generation",
  RAM_SLOTS_EXCEEDED: "slot count",
  RAM_SPEED_LIMITED: "RAM speed",
  FORM_FACTOR_MISMATCH: "form factor",
  PSU_FORM_FACTOR: "form factor",
  COOLER_UNDERSIZED: "cooler capacity",
  PSU_INSUFFICIENT: "power budget",
  PSU_LOW_HEADROOM: "power budget",
  M2_SLOTS_EXCEEDED: "storage connectivity",
  SATA_PORTS_EXCEEDED: "storage connectivity",
  PCIE_GEN_MISMATCH: "PCIe generation",
  NO_IGPU_NO_GPU: "graphics output",
  COOLER_MISSING: "cooling",
  TIER_IMBALANCE: "balance",
  GOAL_SIZE: "size",
};

/** Evaluates one rule against a build, handling missing slots (`unknown`) and missing goal (`not_applicable`). */
export function evaluateRule(rule: Rule, ctx: RuleContext): RuleResult {
  const base = { code: rule.code, severity: rule.severity };
  if (rule.goal && !ctx.goal) return { ...base, result: "not_applicable", reason: "no build goal set", partIds: [] };
  const missing = rule.needs.filter((c) => !(ctx.build.slots[c]?.length ?? 0));
  if (missing.length) {
    const aspect = UNCHECKED_ASPECT[rule.code] ?? "rule";
    return {
      ...base,
      result: "unknown",
      reason: `no ${missing.map((c) => LABEL[c]).join(" or ")} selected yet — ${aspect} unchecked`,
      partIds: [],
    };
  }
  const out = rule.evaluate(ctx);
  return { ...base, result: out.result, reason: out.reason, partIds: out.partIds ?? [] };
}

/** Evaluates every rule. */
export function evaluateAll(ctx: RuleContext): RuleResult[] {
  return RULES.map((r) => evaluateRule(r, ctx));
}

/** Ordinal size ranks reused by ranking/optimizer. */
export const FORM_FACTOR_RANK = { ITX: 0, mATX: 1, ATX: 2, "E-ATX": 3 } as const;
export const PSU_FORM_FACTOR_RANK = { SFX: 0, "SFX-L": 1, ATX: 2 } as const;
