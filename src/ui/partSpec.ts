/** Presentation helpers: engine/catalog parts → the one-line specs the UI shows. Pure, no React. */
import type { Part } from "../data/schema";
import type { RuleCode } from "../engine";
import type { SlotPart } from "./types";
import { genericCardArchetype } from "../engine/cardArchetype";

/** One-line key spec per category, e.g. "AM5 · 8c/16t · 120 W". */
export function specLine(p: Part): string {
  switch (p.category) {
    case "cpu":
      return `${p.socket} · ${p.cores}c/${p.threads}t · ${p.tdpW} W${p.hasIgpu ? " · iGPU" : ""}`;
    case "motherboard":
      return `${p.socket} · ${p.formFactor} · DDR${p.ddrGen} · ${p.chipset}`;
    case "ram":
      return `DDR${p.ddrGen}-${p.speedMHz} · ${p.sticks} × ${p.capacityPerStickGB} GB`;
    case "gpu":
      return `${p.lengthMm} mm · ${p.tdpW} W · ${p.vramGB} GB · PCIe ${p.pcieGen}`;
    case "cooler":
      return p.type === "air" ? `air · ${p.heightMm} mm · ${p.tdpRatingW} W` : `AIO ${p.radiatorMm} mm · ${p.tdpRatingW} W`;
    case "case":
      return `${p.formFactorSupport[p.formFactorSupport.length - 1]} · GPU ≤ ${p.maxGpuLengthMm} mm · cooler ≤ ${p.maxCoolerHeightMm} mm`;
    case "psu":
      return `${p.wattage} W · ${p.formFactor} · ${p.efficiency}`;
    case "storage":
      return `${p.capacityGB >= 1000 ? `${p.capacityGB / 1000} TB` : `${p.capacityGB} GB`} · ${p.interface === "m2-nvme" ? `NVMe Gen ${p.pcieGen ?? "?"}` : "SATA"}`;
  }
}

export function toSlotPart(p: Part): SlotPart {
  return { id: p.id, name: p.name, brand: p.brand, priceUSD: p.priceUSD, verified: p.verified, spec: specLine(p), thumbnailFallback: genericCardArchetype(p) };
}

/** Humanized names for pending rules ("not yet checked: GPU length, PSU wattage"). */
const RULE_HUMAN: Record<RuleCode, string> = {
  SOCKET_MISMATCH: "socket",
  CHIPSET_UNSUPPORTED: "chipset support",
  RAM_TYPE_MISMATCH: "DDR generation",
  RAM_SLOTS_EXCEEDED: "RAM slots",
  RAM_SPEED_LIMITED: "RAM speed",
  FORM_FACTOR_MISMATCH: "form factor",
  GPU_TOO_LONG: "GPU length",
  COOLER_TOO_TALL: "cooler height",
  COOLER_SOCKET_UNSUPPORTED: "cooler socket",
  RADIATOR_UNSUPPORTED: "radiator size",
  COOLER_UNDERSIZED: "cooler rating",
  PSU_INSUFFICIENT: "PSU wattage",
  PSU_LOW_HEADROOM: "PSU headroom",
  PSU_FORM_FACTOR: "PSU form factor",
  NO_IGPU_NO_GPU: "graphics output",
  M2_SLOTS_EXCEEDED: "M.2 slots",
  SATA_PORTS_EXCEEDED: "SATA ports",
  PCIE_GEN_MISMATCH: "PCIe generation",
  COOLER_MISSING: "cooler",
  OVER_BUDGET: "budget",
  GOAL_SLOT_MISSING: "required slots",
  TIER_IMBALANCE: "CPU/GPU balance",
  GOAL_NOISE: "noise",
  GOAL_SIZE: "size",
};

export const humanizeRule = (code: RuleCode): string => RULE_HUMAN[code] ?? code.toLowerCase().replace(/_/g, " ");

export const humanizeRules = (codes: readonly RuleCode[]): string => [...new Set(codes.map(humanizeRule))].join(", ");

export const money = (n: number): string => `$${Math.round(n).toLocaleString()}`;

export const clock = (d: Date = new Date()): string => d.toTimeString().slice(0, 8);
