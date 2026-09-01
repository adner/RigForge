/**
 * Editorial performance estimate (DESIGN §6.2): component tiers, min-tier bottleneck, balance note, PSU load.
 */
import type { PerfKey } from "../data/schema";
import { single } from "./build";
import { estimateWattage, psuHeadroomPct } from "./power";
import { PERF_KEY_BY_WORKLOAD } from "./rules";
import type { Build, Resolution, Workload } from "./types";

export function perfKeyFor(workload: Workload, resolution?: Resolution): PerfKey {
  if (workload !== "gaming") return PERF_KEY_BY_WORKLOAD[workload];
  switch (resolution) {
    case "1080p":
      return "gaming1080p";
    case "4k":
      return "gaming4k";
    default:
      return "gaming1440p";
  }
}

export interface ComponentTier {
  category: "cpu" | "gpu";
  partId: string;
  tier: number;
}

export interface PerformanceResult {
  workload: Workload;
  resolution?: Resolution;
  perfKey: PerfKey;
  components: ComponentTier[];
  /** Lowest-tier component, or undefined when neither CPU nor GPU is present. */
  bottleneck?: ComponentTier;
  /** Overall tier = the bottleneck tier (min), or undefined. */
  overallTier?: number;
  balanceNote: string;
  psu: { estWatts: number; psuWattage?: number; headroomPct?: number };
  /** Always true: the tiers are editorial, not benchmarks. */
  editorial: true;
}

export function performance(build: Build, workload: Workload, resolution?: Resolution): PerformanceResult {
  const perfKey = perfKeyFor(workload, resolution);
  const cpu = single(build, "cpu");
  const gpu = single(build, "gpu");
  const components: ComponentTier[] = [];
  if (cpu) components.push({ category: "cpu", partId: cpu.id, tier: cpu.perfTier[perfKey] });
  if (gpu) components.push({ category: "gpu", partId: gpu.id, tier: gpu.perfTier[perfKey] });

  let bottleneck: ComponentTier | undefined;
  for (const c of components) if (!bottleneck || c.tier < bottleneck.tier) bottleneck = c;

  let balanceNote: string;
  if (!cpu && !gpu) balanceNote = "no CPU or GPU selected yet; nothing to estimate";
  else if (!gpu) {
    balanceNote = cpu!.hasIgpu
      ? `CPU tier ${cpu!.perfTier[perfKey]} for ${perfKey}; running on integrated graphics, add a GPU for graphics workloads`
      : `CPU tier ${cpu!.perfTier[perfKey]} for ${perfKey}; no GPU selected and the CPU has no integrated graphics`;
  } else if (!cpu) balanceNote = `GPU tier ${gpu.perfTier[perfKey]} for ${perfKey}; no CPU selected yet`;
  else {
    const c = cpu.perfTier[perfKey];
    const g = gpu.perfTier[perfKey];
    const diff = Math.abs(c - g);
    if (diff <= 1) balanceNote = `balanced: CPU tier ${c} and GPU tier ${g} for ${perfKey}`;
    else if (c < g) balanceNote = `CPU-limited: CPU tier ${c} holds back GPU tier ${g} for ${perfKey}`;
    else balanceNote = `GPU-limited: GPU tier ${g} holds back CPU tier ${c} for ${perfKey}`;
  }

  const psu = single(build, "psu");
  return {
    workload,
    resolution,
    perfKey,
    components,
    bottleneck,
    overallTier: bottleneck?.tier,
    balanceNote,
    psu: { estWatts: estimateWattage(build), psuWattage: psu?.wattage, headroomPct: psuHeadroomPct(build) },
    editorial: true,
  };
}
