/**
 * Wattage model (DESIGN §5): CPU tdp×1.2 + GPU tdp×1.4 + 5 W per RAM stick / SSD + 30 W board/fans + 50 W base.
 * Documented as an estimate.
 */
import type { Build } from "./types";
import { partsIn, single } from "./build";

export const BASE_WATTS = 50;
export const BOARD_FANS_WATTS = 30;
export const CPU_FACTOR = 1.2;
export const GPU_FACTOR = 1.4;
export const PER_STICK_WATTS = 5;
export const PER_DRIVE_WATTS = 5;

export interface WattageBreakdown {
  cpu: number;
  gpu: number;
  ram: number;
  storage: number;
  board: number;
  base: number;
  total: number;
}

export function wattageBreakdown(build: Build): WattageBreakdown {
  const cpu = single(build, "cpu");
  const gpu = single(build, "gpu");
  const sticks = partsIn(build, "ram").reduce((s, r) => s + r.sticks, 0);
  const drives = partsIn(build, "storage").length;
  const parts = {
    cpu: cpu ? Math.round(cpu.tdpW * CPU_FACTOR) : 0,
    gpu: gpu ? Math.round(gpu.tdpW * GPU_FACTOR) : 0,
    ram: sticks * PER_STICK_WATTS,
    storage: drives * PER_DRIVE_WATTS,
    board: single(build, "motherboard") ? BOARD_FANS_WATTS : 0,
    base: BASE_WATTS,
  };
  const total = parts.cpu + parts.gpu + parts.ram + parts.storage + parts.board + parts.base;
  return { ...parts, total };
}

/** Estimated peak system draw in watts. */
export function estimateWattage(build: Build): number {
  return wattageBreakdown(build).total;
}

/** PSU headroom in percent of PSU wattage ((psu - load) / psu × 100, one decimal), or undefined without a PSU. */
export function psuHeadroomPct(build: Build): number | undefined {
  const psu = single(build, "psu");
  if (!psu) return undefined;
  const load = estimateWattage(build);
  return Math.round(((psu.wattage - load) / psu.wattage) * 1000) / 10;
}
