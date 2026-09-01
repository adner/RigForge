/**
 * Small, realistic fixture catalog for engine tests. Every part is validated with `parsePart` in types.test.ts.
 * Numbers are indicative test data, not verified specs.
 */
import type { Case, Cooler, Cpu, Gpu, Motherboard, Part, PerfTier, Psu, Ram, Storage } from "../../data/schema";
import { indexCatalog } from "../types";

const T = "2026-08-29T00:00:00Z";

type Base = Pick<Part, "id" | "name" | "brand" | "priceUSD" | "verified" | "sources" | "addedBy" | "status" | "priceUpdatedAt" | "updatedAt">;

function base(id: string, name: string, brand: string, priceUSD: number, verified = true): Base {
  return {
    id,
    name,
    brand,
    priceUSD,
    verified,
    sources: verified ? [{ url: "https://example.com/spec", title: "Spec sheet" }] : [],
    addedBy: "seed",
    status: "published",
    priceUpdatedAt: T,
    updatedAt: T,
  };
}

const tiers = (
  g1080: number,
  g1440: number,
  g4k: number,
  streaming: number,
  videoEditing: number,
  rendering3d: number,
  ml: number,
  office: number,
): PerfTier => ({ gaming1080p: g1080, gaming1440p: g1440, gaming4k: g4k, streaming, videoEditing, rendering3d, ml, office });

const ALL_SOCKETS = ["AM5", "AM4", "LGA1851", "LGA1700"] as const;

// ---------- CPUs ----------
export const cpu9800x3d: Cpu = {
  ...base("cpu-r7-9800x3d", "Ryzen 7 9800X3D", "AMD", 479),
  category: "cpu", socket: "AM5", generation: "Zen 5", cores: 8, threads: 16, boostClockMHz: 5200, tdpW: 120,
  hasIgpu: true, includesCooler: false, perfTier: tiers(10, 10, 9, 8, 7, 7, 6, 9),
};
export const cpu9600x: Cpu = {
  ...base("cpu-r5-9600x", "Ryzen 5 9600X", "AMD", 229),
  category: "cpu", socket: "AM5", generation: "Zen 5", cores: 6, threads: 12, boostClockMHz: 5400, tdpW: 65,
  hasIgpu: true, includesCooler: false, perfTier: tiers(8, 8, 8, 6, 6, 5, 5, 8),
};
export const cpu7600: Cpu = {
  ...base("cpu-r5-7600", "Ryzen 5 7600", "AMD", 189),
  category: "cpu", socket: "AM5", generation: "Zen 4", cores: 6, threads: 12, boostClockMHz: 5100, tdpW: 65,
  hasIgpu: true, includesCooler: true, perfTier: tiers(7, 7, 7, 5, 5, 4, 4, 7),
};
export const cpu9950x: Cpu = {
  ...base("cpu-r9-9950x", "Ryzen 9 9950X", "AMD", 599),
  category: "cpu", socket: "AM5", generation: "Zen 5", cores: 16, threads: 32, boostClockMHz: 5700, tdpW: 170,
  hasIgpu: true, includesCooler: false, perfTier: tiers(9, 9, 9, 10, 10, 10, 9, 10),
};
export const cpu265k: Cpu = {
  ...base("cpu-core-ultra-7-265k", "Core Ultra 7 265K", "Intel", 329),
  category: "cpu", socket: "LGA1851", generation: "Arrow Lake", cores: 20, threads: 20, boostClockMHz: 5500, tdpW: 125,
  hasIgpu: true, includesCooler: false, perfTier: tiers(8, 8, 8, 9, 9, 9, 8, 10),
};
export const cpu14600k: Cpu = {
  ...base("cpu-i5-14600k", "Core i5-14600K", "Intel", 249),
  category: "cpu", socket: "LGA1700", generation: "Raptor Lake", cores: 14, threads: 20, boostClockMHz: 5300, tdpW: 125,
  hasIgpu: true, includesCooler: false, perfTier: tiers(8, 8, 8, 7, 7, 7, 6, 9),
};
export const cpu5700x: Cpu = {
  ...base("cpu-r7-5700x", "Ryzen 7 5700X", "AMD", 159),
  category: "cpu", socket: "AM4", generation: "Zen 3", cores: 8, threads: 16, boostClockMHz: 4600, tdpW: 65,
  hasIgpu: false, includesCooler: false, perfTier: tiers(6, 6, 6, 6, 5, 5, 4, 7),
};
export const cpu2600: Cpu = {
  ...base("cpu-r5-2600", "Ryzen 5 2600", "AMD", 79, false),
  category: "cpu", socket: "AM4", generation: "Zen+", cores: 6, threads: 12, boostClockMHz: 3900, tdpW: 65,
  hasIgpu: false, includesCooler: true, perfTier: tiers(3, 3, 3, 3, 3, 3, 2, 5),
};

// ---------- Motherboards ----------
export const mbB650Atx: Motherboard = {
  ...base("mb-b650-atx", "B650 Tomahawk", "MSI", 179),
  category: "motherboard", socket: "AM5", chipset: "B650", formFactor: "ATX", ddrGen: 5, maxRamSpeedMHz: 7200,
  ramSlots: 4, m2Slots: 3, sataPorts: 4, pcieGen: 4,
};
export const mbX870eAtx: Motherboard = {
  ...base("mb-x870e-atx", "X870E Aorus Pro", "Gigabyte", 329),
  category: "motherboard", socket: "AM5", chipset: "X870E", formFactor: "ATX", ddrGen: 5, maxRamSpeedMHz: 8000,
  ramSlots: 4, m2Slots: 4, sataPorts: 4, pcieGen: 5,
};
export const mbB850Itx: Motherboard = {
  ...base("mb-b850-itx", "B850I Gaming", "ASRock", 249),
  category: "motherboard", socket: "AM5", chipset: "B850", formFactor: "ITX", ddrGen: 5, maxRamSpeedMHz: 8000,
  ramSlots: 2, m2Slots: 2, sataPorts: 2, pcieGen: 5,
};
export const mbA620Matx: Motherboard = {
  ...base("mb-a620-matx", "A620M Pro", "MSI", 99, false),
  category: "motherboard", socket: "AM5", chipset: "A620", formFactor: "mATX", ddrGen: 5, maxRamSpeedMHz: 6400,
  ramSlots: 2, m2Slots: 1, sataPorts: 4, pcieGen: 4,
};
export const mbZ890Atx: Motherboard = {
  ...base("mb-z890-atx", "Z890 Tomahawk", "MSI", 349),
  category: "motherboard", socket: "LGA1851", chipset: "Z890", formFactor: "ATX", ddrGen: 5, maxRamSpeedMHz: 8400,
  ramSlots: 4, m2Slots: 4, sataPorts: 4, pcieGen: 5,
};
export const mbB550Matx: Motherboard = {
  ...base("mb-b550-matx", "B550M Pro", "MSI", 109),
  category: "motherboard", socket: "AM4", chipset: "B550", formFactor: "mATX", ddrGen: 4, maxRamSpeedMHz: 4400,
  ramSlots: 4, m2Slots: 2, sataPorts: 4, pcieGen: 4,
};
export const mbB760Matx: Motherboard = {
  ...base("mb-b760-matx", "B760M Gaming", "ASUS", 139),
  category: "motherboard", socket: "LGA1700", chipset: "B760", formFactor: "mATX", ddrGen: 5, maxRamSpeedMHz: 7200,
  ramSlots: 4, m2Slots: 2, sataPorts: 4, pcieGen: 4,
};

// ---------- RAM ----------
export const ramDdr5_6000_2x16: Ram = {
  ...base("ram-ddr5-6000-2x16", "Vengeance DDR5-6000 32GB", "Corsair", 99),
  category: "ram", ddrGen: 5, speedMHz: 6000, sticks: 2, capacityPerStickGB: 16, hasRgb: false,
};
export const ramDdr5_6000_2x16Rgb: Ram = {
  ...base("ram-ddr5-6000-2x16-rgb", "Trident Z5 RGB DDR5-6000 32GB", "G.Skill", 119),
  category: "ram", ddrGen: 5, speedMHz: 6000, sticks: 2, capacityPerStickGB: 16, hasRgb: true,
};
export const ramDdr5_6400_2x32: Ram = {
  ...base("ram-ddr5-6400-2x32", "Flare X5 DDR5-6400 64GB", "G.Skill", 219),
  category: "ram", ddrGen: 5, speedMHz: 6400, sticks: 2, capacityPerStickGB: 32, hasRgb: false,
};
export const ramDdr5_8000_2x24: Ram = {
  ...base("ram-ddr5-8000-2x24", "Trident Z5 DDR5-8000 48GB", "G.Skill", 249),
  category: "ram", ddrGen: 5, speedMHz: 8000, sticks: 2, capacityPerStickGB: 24, hasRgb: false,
};
export const ramDdr5_5600_4x16: Ram = {
  ...base("ram-ddr5-5600-4x16", "Fury Beast DDR5-5600 64GB", "Kingston", 189),
  category: "ram", ddrGen: 5, speedMHz: 5600, sticks: 4, capacityPerStickGB: 16, hasRgb: false,
};
export const ramDdr5_5600_2x8: Ram = {
  ...base("ram-ddr5-5600-2x8", "Fury Beast DDR5-5600 16GB", "Kingston", 49),
  category: "ram", ddrGen: 5, speedMHz: 5600, sticks: 2, capacityPerStickGB: 8, hasRgb: false,
};
export const ramDdr4_3200_2x16: Ram = {
  ...base("ram-ddr4-3200-2x16", "Vengeance LPX DDR4-3200 32GB", "Corsair", 59),
  category: "ram", ddrGen: 4, speedMHz: 3200, sticks: 2, capacityPerStickGB: 16, hasRgb: false,
};

// ---------- GPUs ----------
export const gpu5090: Gpu = {
  ...base("gpu-rtx-5090", "GeForce RTX 5090", "NVIDIA", 1999),
  category: "gpu", lengthMm: 358, slots: 3.5, tdpW: 575, pcieGen: 5, recommendedPsuW: 1000, vramGB: 32, noiseTier: 3,
  perfTier: tiers(10, 10, 10, 10, 10, 10, 10, 10),
};
export const gpu5080: Gpu = {
  ...base("gpu-rtx-5080", "GeForce RTX 5080", "NVIDIA", 999),
  category: "gpu", lengthMm: 304, slots: 3, tdpW: 360, pcieGen: 5, recommendedPsuW: 850, vramGB: 16, noiseTier: 3,
  perfTier: tiers(10, 9, 9, 9, 9, 9, 8, 10),
};
export const gpu5070ti: Gpu = {
  ...base("gpu-rtx-5070ti", "GeForce RTX 5070 Ti", "NVIDIA", 749),
  category: "gpu", lengthMm: 300, slots: 2.5, tdpW: 300, pcieGen: 5, recommendedPsuW: 750, vramGB: 16, noiseTier: 2,
  perfTier: tiers(9, 9, 8, 8, 8, 8, 7, 10),
};
export const gpu5070: Gpu = {
  ...base("gpu-rtx-5070", "GeForce RTX 5070", "NVIDIA", 549),
  category: "gpu", lengthMm: 242, slots: 2, tdpW: 250, pcieGen: 5, recommendedPsuW: 650, vramGB: 12, noiseTier: 2,
  perfTier: tiers(9, 8, 6, 7, 7, 7, 6, 10),
};
export const gpu9070xt: Gpu = {
  ...base("gpu-rx-9070xt", "Radeon RX 9070 XT", "AMD", 599),
  category: "gpu", lengthMm: 330, slots: 2.5, tdpW: 304, pcieGen: 5, recommendedPsuW: 750, vramGB: 16, noiseTier: 3,
  perfTier: tiers(9, 9, 8, 7, 7, 7, 5, 10),
};
export const gpu5060: Gpu = {
  ...base("gpu-rtx-5060", "GeForce RTX 5060", "NVIDIA", 299),
  category: "gpu", lengthMm: 200, slots: 2, tdpW: 145, pcieGen: 5, recommendedPsuW: 550, vramGB: 8, noiseTier: 2,
  perfTier: tiers(7, 6, 4, 5, 5, 5, 4, 10),
};
export const gpu4060: Gpu = {
  ...base("gpu-rtx-4060", "GeForce RTX 4060", "NVIDIA", 279),
  category: "gpu", lengthMm: 245, slots: 2, tdpW: 115, pcieGen: 4, recommendedPsuW: 550, vramGB: 8, noiseTier: 1,
  perfTier: tiers(6, 5, 3, 5, 4, 4, 3, 10),
};
export const gpu7600: Gpu = {
  ...base("gpu-rx-7600", "Radeon RX 7600", "AMD", 249, false),
  category: "gpu", lengthMm: 204, slots: 2, tdpW: 165, pcieGen: 4, recommendedPsuW: 550, vramGB: 8, noiseTier: 4,
  perfTier: tiers(6, 5, 3, 4, 4, 4, 3, 10),
};

// ---------- Coolers ----------
export const coolerAir155: Cooler = {
  ...base("cooler-tower-air-155", "Peerless Assassin 120", "Thermalright", 39),
  category: "cooler", type: "air", heightMm: 155, socketSupport: [...ALL_SOCKETS], tdpRatingW: 250, noiseTier: 2, hasRgb: false,
};
export const coolerAir165: Cooler = {
  ...base("cooler-tower-air-165", "NH-D15 G2", "Noctua", 99),
  category: "cooler", type: "air", heightMm: 165, socketSupport: [...ALL_SOCKETS], tdpRatingW: 250, noiseTier: 1, hasRgb: false,
};
export const coolerLowProfile47: Cooler = {
  ...base("cooler-lowprofile-47", "AXP90-X47", "Thermalright", 45),
  category: "cooler", type: "air", heightMm: 47, socketSupport: [...ALL_SOCKETS], tdpRatingW: 95, noiseTier: 3, hasRgb: false,
};
export const coolerAirLgaOnly: Cooler = {
  ...base("cooler-air-lga-only", "Hyper 212 LGA Edition", "Cooler Master", 49, false),
  category: "cooler", type: "air", heightMm: 158, socketSupport: ["LGA1851", "LGA1700"], tdpRatingW: 200, noiseTier: 2, hasRgb: false,
};
export const coolerAio360: Cooler = {
  ...base("cooler-aio-360", "Liquid Freezer III 360", "Arctic", 149),
  category: "cooler", type: "aio", radiatorMm: 360, socketSupport: [...ALL_SOCKETS], tdpRatingW: 300, noiseTier: 2, hasRgb: true,
};
export const coolerAio280: Cooler = {
  ...base("cooler-aio-280", "Liquid Freezer III 280", "Arctic", 129),
  category: "cooler", type: "aio", radiatorMm: 280, socketSupport: [...ALL_SOCKETS], tdpRatingW: 280, noiseTier: 2, hasRgb: false,
};
export const coolerAio240: Cooler = {
  ...base("cooler-aio-240", "Liquid Freezer III 240", "Arctic", 99),
  category: "cooler", type: "aio", radiatorMm: 240, socketSupport: [...ALL_SOCKETS], tdpRatingW: 250, noiseTier: 3, hasRgb: true,
};
export const coolerAio420: Cooler = {
  ...base("cooler-aio-420", "Liquid Freezer III 420", "Arctic", 189),
  category: "cooler", type: "aio", radiatorMm: 420, socketSupport: [...ALL_SOCKETS], tdpRatingW: 350, noiseTier: 2, hasRgb: false,
};

// ---------- Cases ----------
export const caseMidAtxBlack: Case = {
  ...base("case-mid-atx-black", "Flux Pro", "Montech", 99),
  category: "case", formFactorSupport: ["ITX", "mATX", "ATX"], maxGpuLengthMm: 400, maxCoolerHeightMm: 170,
  radiatorSupport: [120, 140, 240, 280, 360], psuFormFactor: ["ATX"], volumeLiters: 40, color: "black", hasWindow: true,
  frontStyle: "mesh", noiseTier: 2,
};
export const caseMidAtxWhiteGlass: Case = {
  ...base("case-mid-atx-white-glass", "North Chalk White", "Fractal", 119),
  category: "case", formFactorSupport: ["ITX", "mATX", "ATX"], maxGpuLengthMm: 355, maxCoolerHeightMm: 170,
  radiatorSupport: [120, 140, 240, 280, 360], psuFormFactor: ["ATX"], volumeLiters: 38, color: "white", hasWindow: true,
  frontStyle: "glass", noiseTier: 3,
};
export const caseItx15l: Case = {
  ...base("case-itx-15l", "Formd T1", "Formd", 179),
  category: "case", formFactorSupport: ["ITX"], maxGpuLengthMm: 330, maxCoolerHeightMm: 70, radiatorSupport: [240],
  psuFormFactor: ["SFX", "SFX-L"], volumeLiters: 15, color: "black", hasWindow: false, frontStyle: "solid", noiseTier: 3,
};
export const caseItx12l: Case = {
  ...base("case-itx-small-12l", "Dan A4-H2O", "Lian Li", 229),
  category: "case", formFactorSupport: ["ITX"], maxGpuLengthMm: 300, maxCoolerHeightMm: 55, radiatorSupport: [],
  psuFormFactor: ["SFX"], volumeLiters: 12, color: "silver", hasWindow: false, frontStyle: "solid", noiseTier: 3,
};
export const caseMatxCompact25l: Case = {
  ...base("case-matx-compact-25l", "Meshify 2 Nano", "Fractal", 89),
  category: "case", formFactorSupport: ["ITX", "mATX"], maxGpuLengthMm: 340, maxCoolerHeightMm: 160, radiatorSupport: [120, 240],
  psuFormFactor: ["ATX", "SFX"], volumeLiters: 24, color: "black", hasWindow: true, frontStyle: "mesh", noiseTier: 2,
};
export const caseFullTower60l: Case = {
  ...base("case-full-tower-60l", "Torrent", "Fractal", 199),
  category: "case", formFactorSupport: ["ITX", "mATX", "ATX", "E-ATX"], maxGpuLengthMm: 460, maxCoolerHeightMm: 190,
  radiatorSupport: [120, 140, 240, 280, 360, 420], psuFormFactor: ["ATX"], volumeLiters: 62, color: "black", hasWindow: true,
  frontStyle: "glass", noiseTier: 1,
};
export const caseMidSilent: Case = {
  ...base("case-mid-silent", "Define 7 Compact", "Fractal", 129),
  category: "case", formFactorSupport: ["mATX", "ATX"], maxGpuLengthMm: 380, maxCoolerHeightMm: 175,
  radiatorSupport: [120, 140, 240, 280, 360], psuFormFactor: ["ATX"], volumeLiters: 39, color: "black", hasWindow: false,
  frontStyle: "solid", noiseTier: 1,
};
export const caseLoudBudget: Case = {
  ...base("case-loud-budget", "Budget Mesh 500", "Generic", 59, false),
  category: "case", formFactorSupport: ["mATX", "ATX"], maxGpuLengthMm: 350, maxCoolerHeightMm: 160, radiatorSupport: [120, 240],
  psuFormFactor: ["ATX"], volumeLiters: 36, color: "black", hasWindow: true, frontStyle: "mesh", noiseTier: 4,
};

// ---------- PSUs ----------
const psu = (id: string, name: string, brand: string, price: number, wattage: number, formFactor: Psu["formFactor"], efficiency: Psu["efficiency"], modular: Psu["modular"], noiseTier: number, verified = true): Psu => ({
  ...base(id, name, brand, price, verified),
  category: "psu", wattage, formFactor, efficiency, modular, noiseTier,
});
export const psuAtx550Bronze = psu("psu-atx-550-bronze", "CV550", "Corsair", 59, 550, "ATX", "80+ Bronze", "none", 3);
export const psuAtx650Gold = psu("psu-atx-650-gold", "RM650e", "Corsair", 89, 650, "ATX", "80+ Gold", "full", 2);
export const psuAtx750Gold = psu("psu-atx-750-gold", "RM750e", "Corsair", 109, 750, "ATX", "80+ Gold", "full", 2);
export const psuAtx850Gold = psu("psu-atx-850-gold", "RM850e", "Corsair", 129, 850, "ATX", "80+ Gold", "full", 2);
export const psuAtx1000Gold = psu("psu-atx-1000-gold", "RM1000e", "Corsair", 169, 1000, "ATX", "80+ Gold", "full", 2);
export const psuAtx1200Platinum = psu("psu-atx-1200-platinum", "HX1200i", "Corsair", 249, 1200, "ATX", "80+ Platinum", "full", 1);
export const psuSfx650Gold = psu("psu-sfx-650-gold", "SF650", "Corsair", 119, 650, "SFX", "80+ Gold", "full", 3);
export const psuSfx750Platinum = psu("psu-sfx-750-platinum", "SF750", "Corsair", 159, 750, "SFX", "80+ Platinum", "full", 2);
export const psuSfx1000Platinum = psu("psu-sfx-1000-platinum", "SF1000", "Corsair", 219, 1000, "SFX", "80+ Platinum", "full", 3);

// ---------- Storage ----------
export const ssdNvmeGen4_1tb: Storage = { ...base("ssd-nvme-gen4-1tb", "990 Pro 1TB", "Samsung", 79), category: "storage", interface: "m2-nvme", capacityGB: 1000, pcieGen: 4 };
export const ssdNvmeGen4_2tb: Storage = { ...base("ssd-nvme-gen4-2tb", "990 Pro 2TB", "Samsung", 139), category: "storage", interface: "m2-nvme", capacityGB: 2000, pcieGen: 4 };
export const ssdNvmeGen5_2tb: Storage = { ...base("ssd-nvme-gen5-2tb", "T705 2TB", "Crucial", 199), category: "storage", interface: "m2-nvme", capacityGB: 2000, pcieGen: 5 };
export const ssdNvmeGen3_500: Storage = { ...base("ssd-nvme-gen3-500gb", "SN570 500GB", "WD", 45, false), category: "storage", interface: "m2-nvme", capacityGB: 500, pcieGen: 3 };
export const ssdNvmeGen4_4tb: Storage = { ...base("ssd-nvme-gen4-4tb", "990 Pro 4TB", "Samsung", 259), category: "storage", interface: "m2-nvme", capacityGB: 4000, pcieGen: 4 };
export const ssdSata1tb: Storage = { ...base("ssd-sata-1tb", "870 Evo 1TB", "Samsung", 69), category: "storage", interface: "sata", capacityGB: 1000 };
export const ssdSata2tb: Storage = { ...base("ssd-sata-2tb", "870 Evo 2TB", "Samsung", 119), category: "storage", interface: "sata", capacityGB: 2000 };
export const ssdSata4tb: Storage = { ...base("ssd-sata-4tb", "870 Evo 4TB", "Samsung", 199), category: "storage", interface: "sata", capacityGB: 4000 };

export const FIXTURE_PARTS: Part[] = [
  cpu9800x3d, cpu9600x, cpu7600, cpu9950x, cpu265k, cpu14600k, cpu5700x, cpu2600,
  mbB650Atx, mbX870eAtx, mbB850Itx, mbA620Matx, mbZ890Atx, mbB550Matx, mbB760Matx,
  ramDdr5_6000_2x16, ramDdr5_6000_2x16Rgb, ramDdr5_6400_2x32, ramDdr5_8000_2x24, ramDdr5_5600_4x16, ramDdr5_5600_2x8, ramDdr4_3200_2x16,
  gpu5090, gpu5080, gpu5070ti, gpu5070, gpu9070xt, gpu5060, gpu4060, gpu7600,
  coolerAir155, coolerAir165, coolerLowProfile47, coolerAirLgaOnly, coolerAio360, coolerAio280, coolerAio240, coolerAio420,
  caseMidAtxBlack, caseMidAtxWhiteGlass, caseItx15l, caseItx12l, caseMatxCompact25l, caseFullTower60l, caseMidSilent, caseLoudBudget,
  psuAtx550Bronze, psuAtx650Gold, psuAtx750Gold, psuAtx850Gold, psuAtx1000Gold, psuAtx1200Platinum, psuSfx650Gold, psuSfx750Platinum, psuSfx1000Platinum,
  ssdNvmeGen4_1tb, ssdNvmeGen4_2tb, ssdNvmeGen5_2tb, ssdNvmeGen3_500, ssdNvmeGen4_4tb, ssdSata1tb, ssdSata2tb, ssdSata4tb,
];

export const CATALOG = indexCatalog(FIXTURE_PARTS);

/** A complete, conflict-free build (no goal). Total $2162, est. 659 W on a 1000 W PSU. */
export const GOOD_PARTS: Part[] = [cpu9800x3d, mbX870eAtx, ramDdr5_6000_2x16, gpu5070ti, coolerAir165, caseMidAtxBlack, psuAtx1000Gold, ssdNvmeGen4_2tb];
