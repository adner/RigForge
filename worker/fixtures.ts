/** Small valid parts for Worker tests (not the real dataset). */
import type { Case, Cpu, Gpu, PerfTier, Ram } from "../src/data/schema";

export const T0 = "2026-08-29T10:00:00.000Z";

const perf: PerfTier = { gaming1080p: 7, gaming1440p: 6, gaming4k: 4, streaming: 6, videoEditing: 6, rendering3d: 6, ml: 4, office: 9 };

export const cpuFixture: Cpu = {
  id: "cpu-test-7600",
  name: "Test 7600",
  brand: "Testbrand",
  category: "cpu",
  priceUSD: 199,
  verified: true,
  sources: [{ url: "https://example.com/spec/7600", title: "Spec sheet" }],
  addedBy: "seed",
  status: "published",
  priceUpdatedAt: T0,
  updatedAt: T0,
  socket: "AM5",
  generation: "Zen 4",
  cores: 6,
  threads: 12,
  boostClockMHz: 5100,
  tdpW: 65,
  hasIgpu: true,
  includesCooler: true,
  perfTier: perf,
};

export const gpuFixture: Gpu = {
  id: "gpu-test-5060",
  name: "Test 5060",
  brand: "Testbrand",
  category: "gpu",
  priceUSD: 329,
  verified: false,
  sources: [],
  addedBy: "seed",
  status: "published",
  priceUpdatedAt: T0,
  updatedAt: T0,
  lengthMm: 242,
  slots: 2,
  tdpW: 145,
  pcieGen: 5,
  recommendedPsuW: 550,
  vramGB: 8,
  noiseTier: 2,
  perfTier: perf,
};

/** A new GPU as an agent would submit it (no server-controlled fields). */
export const gpuDraftInput = {
  id: "gpu-test-5060-ti-16gb",
  name: "Test 5060 Ti 16GB",
  brand: "Testbrand",
  category: "gpu",
  priceUSD: 429,
  sources: [{ url: "https://example.com/spec/5060ti" }],
  lengthMm: 250,
  slots: 2,
  tdpW: 180,
  pcieGen: 5,
  recommendedPsuW: 600,
  vramGB: 16,
  noiseTier: 2,
  perfTier: perf,
};

export const caseFixture: Case = {
  id: "case-test-mid",
  name: "Test Mid",
  brand: "Testbrand",
  category: "case",
  priceUSD: 99,
  verified: true,
  sources: [],
  addedBy: "seed",
  status: "published",
  priceUpdatedAt: T0,
  updatedAt: T0,
  formFactorSupport: ["ATX", "mATX", "ITX"],
  maxGpuLengthMm: 360,
  maxCoolerHeightMm: 170,
  radiatorSupport: [240, 360],
  psuFormFactor: ["ATX"],
  volumeLiters: 38,
  color: "black",
  hasWindow: true,
  frontStyle: "mesh",
  noiseTier: 2,
};

export const ramFixture: Ram = {
  id: "ram-test-32",
  name: "Test 32GB",
  brand: "Testbrand",
  category: "ram",
  priceUSD: 89,
  verified: true,
  sources: [],
  addedBy: "seed",
  status: "published",
  priceUpdatedAt: T0,
  updatedAt: T0,
  ddrGen: 5,
  speedMHz: 6000,
  sticks: 2,
  capacityPerStickGB: 16,
  hasRgb: false,
};
