/**
 * RigBuilder catalog schema — the single source of truth for part shapes.
 * Shared by: seed JSON validation (check.ts), D1 import, /api/catalog, the engine,
 * the shopper + admin WebMCP tools, and the admin UI form generator.
 * See docs/DESIGN.md §6.
 *
 * Conventions: lengths in mm, power in W, clocks in MHz, capacity in GB, prices in USD.
 */
import { z } from "zod";

// ---------- enums ----------

export const CATEGORIES = ["cpu", "motherboard", "ram", "gpu", "cooler", "case", "psu", "storage"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Which categories may hold more than one part in a build. */
export const MULTI_SLOT_CATEGORIES: readonly Category[] = ["ram", "storage"];

export const SOCKETS = ["AM5", "AM4", "LGA1851", "LGA1700"] as const;
export const FORM_FACTORS = ["ITX", "mATX", "ATX", "E-ATX"] as const; // motherboard, ordered small → large
export const PSU_FORM_FACTORS = ["SFX", "SFX-L", "ATX"] as const; // ordered small → large
export const DDR_GENS = [4, 5] as const;
export const PCIE_GENS = [3, 4, 5] as const;
export const RADIATOR_SIZES = [120, 140, 240, 280, 360, 420] as const;
export const STORAGE_INTERFACES = ["m2-nvme", "sata"] as const;
export const COOLER_TYPES = ["air", "aio"] as const;
export const PSU_EFFICIENCIES = ["80+", "80+ Bronze", "80+ Gold", "80+ Platinum", "80+ Titanium"] as const;
export const CASE_COLORS = ["black", "white", "silver", "other"] as const;
export const FRONT_STYLES = ["mesh", "solid", "glass"] as const;
export const ADDED_BY = ["seed", "human", "agent"] as const;
export const PART_STATUS = ["published", "draft"] as const;

/** Performance-tier keys (1–10, editorial). See DESIGN §6.2. */
export const PERF_KEYS = [
  "gaming1080p",
  "gaming1440p",
  "gaming4k",
  "streaming",
  "videoEditing",
  "rendering3d",
  "ml",
  "office",
] as const;
export type PerfKey = (typeof PERF_KEYS)[number];

export const WORKLOADS = ["gaming", "streaming", "video-editing", "3d-rendering", "ml", "office"] as const;
export const RESOLUTIONS = ["1080p", "1440p", "4k"] as const;

// ---------- shared pieces ----------

const tier = z.number().int().min(1).max(10);
export const perfTierSchema = z.object(Object.fromEntries(PERF_KEYS.map((k) => [k, tier])) as Record<PerfKey, typeof tier>);
export type PerfTier = z.infer<typeof perfTierSchema>;

/** 1 = near-silent … 5 = loud. Editorial, sourced from rated dBA where published. */
export const noiseTierSchema = z.number().int().min(1).max(5);

const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/https?:\/\/|<[^>]+>|[\r\n]/.test(s), "plain text only (no URLs, markup or newlines)");

export const sourceSchema = z.object({
  url: z.url().max(500).refine((u) => u.startsWith("https://"), "https only"),
  title: plainText(120).optional(),
});
export type Source = z.infer<typeof sourceSchema>;

const isoDate = z.iso.datetime({ offset: true });

/** Fields every part carries, regardless of category. */
/** Category schemas are `.strict()`: unknown keys are rejected so agent typos surface as errors (REVIEW_RESPONSES.md). */
export const partBaseSchema = z.object({
  id: z.string().regex(/^(cpu|mb|ram|gpu|cooler|case|psu|ssd)-[a-z0-9]+(-[a-z0-9]+)*$/, "id format: <prefix>-<slug>"),
  name: plainText(80),
  brand: plainText(40),
  priceUSD: z.number().positive().max(20000),
  /** Human-verified against the recorded sources. Agents can never set this. */
  verified: z.boolean(),
  sources: z.array(sourceSchema).max(5).default([]),
  addedBy: z.enum(ADDED_BY).default("seed"),
  status: z.enum(PART_STATUS).default("published"),
  priceUpdatedAt: isoDate,
  updatedAt: isoDate,
});

/**
 * Chipset → supported CPU generations. Simplified support table (DESIGN §5, CHIPSET_UNSUPPORTED).
 * Documented in data/SOURCES.md. Keys are motherboard.chipset values; values are cpu.generation values.
 */
export const CHIPSET_SUPPORT: Record<string, readonly string[]> = {
  // AM5
  X870E: ["Zen 5", "Zen 4"],
  X870: ["Zen 5", "Zen 4"],
  X670E: ["Zen 5", "Zen 4"],
  X670: ["Zen 5", "Zen 4"],
  B850: ["Zen 5", "Zen 4"],
  B650E: ["Zen 5", "Zen 4"],
  B650: ["Zen 5", "Zen 4"],
  A620: ["Zen 5", "Zen 4"],
  // AM4
  X570: ["Zen 3", "Zen 2"],
  B550: ["Zen 3", "Zen 2"],
  A520: ["Zen 3", "Zen 2"],
  // LGA1851
  Z890: ["Arrow Lake"],
  B860: ["Arrow Lake"],
  H810: ["Arrow Lake"],
  // LGA1700
  Z790: ["Raptor Lake", "Alder Lake"],
  B760: ["Raptor Lake", "Alder Lake"],
  H770: ["Raptor Lake", "Alder Lake"],
  Z690: ["Raptor Lake", "Alder Lake"],
  B660: ["Raptor Lake", "Alder Lake"],
};

export const CHIPSETS = Object.keys(CHIPSET_SUPPORT) as [string, ...string[]];

// ---------- per-category ----------

export const cpuSchema = partBaseSchema.extend({
  category: z.literal("cpu"),
  socket: z.enum(SOCKETS),
  /** e.g. "Zen 5", "Zen 4", "Arrow Lake", "Raptor Lake" — must match a chipset support table entry. */
  generation: plainText(40),
  cores: z.number().int().min(2).max(64),
  threads: z.number().int().min(2).max(128),
  boostClockMHz: z.number().int().min(2000).max(7000),
  tdpW: z.number().int().min(15).max(400),
  hasIgpu: z.boolean(),
  includesCooler: z.boolean(),
  perfTier: perfTierSchema,
}).strict();

export const motherboardSchema = partBaseSchema.extend({
  category: z.literal("motherboard"),
  socket: z.enum(SOCKETS),
  chipset: z.enum(CHIPSETS),
  formFactor: z.enum(FORM_FACTORS),
  ddrGen: z.union([z.literal(4), z.literal(5)]),
  maxRamSpeedMHz: z.number().int().min(2133).max(10000),
  ramSlots: z.number().int().min(1).max(8),
  m2Slots: z.number().int().min(0).max(6),
  sataPorts: z.number().int().min(0).max(12),
  pcieGen: z.union([z.literal(3), z.literal(4), z.literal(5)]),
}).strict();

export const ramSchema = partBaseSchema.extend({
  category: z.literal("ram"),
  ddrGen: z.union([z.literal(4), z.literal(5)]),
  speedMHz: z.number().int().min(2133).max(10000),
  sticks: z.number().int().min(1).max(4),
  capacityPerStickGB: z.number().int().min(4).max(64),
  hasRgb: z.boolean(),
}).strict();

export const gpuSchema = partBaseSchema.extend({
  category: z.literal("gpu"),
  lengthMm: z.number().int().min(100).max(450),
  /** Expansion slots occupied (thickness). */
  slots: z.number().min(1).max(4),
  tdpW: z.number().int().min(30).max(700),
  pcieGen: z.union([z.literal(3), z.literal(4), z.literal(5)]),
  recommendedPsuW: z.number().int().min(200).max(1600),
  vramGB: z.number().int().min(2).max(96),
  noiseTier: noiseTierSchema,
  perfTier: perfTierSchema,
}).strict();

export const coolerSchema = partBaseSchema
  .extend({
    category: z.literal("cooler"),
    type: z.enum(COOLER_TYPES),
    /** Air coolers only. */
    heightMm: z.number().int().min(20).max(200).optional(),
    /** AIO only. */
    radiatorMm: z.literal([...RADIATOR_SIZES]).optional(),
    socketSupport: z.array(z.enum(SOCKETS)).min(1),
    tdpRatingW: z.number().int().min(50).max(500),
    noiseTier: noiseTierSchema,
    hasRgb: z.boolean(),
  })
  .strict()
  .refine((c) => (c.type === "air" ? c.heightMm != null && c.radiatorMm == null : c.radiatorMm != null && c.heightMm == null), {
    message: "air coolers need heightMm (no radiatorMm); AIOs need radiatorMm (no heightMm)",
  });

export const caseSchema = partBaseSchema.extend({
  category: z.literal("case"),
  formFactorSupport: z.array(z.enum(FORM_FACTORS)).min(1),
  maxGpuLengthMm: z.number().int().min(150).max(500),
  maxCoolerHeightMm: z.number().int().min(40).max(220),
  radiatorSupport: z.array(z.literal([...RADIATOR_SIZES])),
  psuFormFactor: z.array(z.enum(PSU_FORM_FACTORS)).min(1),
  volumeLiters: z.number().min(5).max(120),
  color: z.enum(CASE_COLORS),
  hasWindow: z.boolean(),
  frontStyle: z.enum(FRONT_STYLES),
  noiseTier: noiseTierSchema,
}).strict();

export const psuSchema = partBaseSchema.extend({
  category: z.literal("psu"),
  wattage: z.number().int().min(300).max(2000),
  formFactor: z.enum(PSU_FORM_FACTORS),
  efficiency: z.enum(PSU_EFFICIENCIES),
  modular: z.enum(["none", "semi", "full"]),
  noiseTier: noiseTierSchema,
}).strict();

export const storageSchema = partBaseSchema.extend({
  category: z.literal("storage"),
  interface: z.enum(STORAGE_INTERFACES),
  capacityGB: z.number().int().min(120).max(16000),
  /** NVMe only; omitted for SATA. */
  pcieGen: z.union([z.literal(3), z.literal(4), z.literal(5)]).optional(),
}).strict();

export const partSchema = z.discriminatedUnion("category", [
  cpuSchema,
  motherboardSchema,
  ramSchema,
  gpuSchema,
  coolerSchema,
  caseSchema,
  psuSchema,
  storageSchema,
]);

/** Validate a single part of any category. */
export const parsePart = (input: unknown): Part => partSchema.parse(input);
export const safeParsePart = (input: unknown) => partSchema.safeParse(input);

export type Cpu = z.infer<typeof cpuSchema>;
export type Motherboard = z.infer<typeof motherboardSchema>;
export type Ram = z.infer<typeof ramSchema>;
export type Gpu = z.infer<typeof gpuSchema>;
export type Cooler = z.infer<typeof coolerSchema>;
export type Case = z.infer<typeof caseSchema>;
export type Psu = z.infer<typeof psuSchema>;
export type Storage = z.infer<typeof storageSchema>;
export type Part = Cpu | Motherboard | Ram | Gpu | Cooler | Case | Psu | Storage;
export type PartOf<C extends Category> = Extract<Part, { category: C }>;

export const schemaByCategory = {
  cpu: cpuSchema,
  motherboard: motherboardSchema,
  ram: ramSchema,
  gpu: gpuSchema,
  cooler: coolerSchema,
  case: caseSchema,
  psu: psuSchema,
  storage: storageSchema,
} as const;

/** Prefix used in ids per category. */
export const ID_PREFIX: Record<Category, string> = {
  cpu: "cpu",
  motherboard: "mb",
  ram: "ram",
  gpu: "gpu",
  cooler: "cooler",
  case: "case",
  psu: "psu",
  storage: "ssd",
};

// ---------- catalog-level ----------

export const catalogSchema = z.object({
  /** Monotonic; bumped on every publish. */
  catalogVersion: z.number().int().min(1),
  /** ISO date of the price/spec snapshot shown in the UI footer. */
  snapshotDate: z.iso.date(),
  parts: z.array(partSchema),
});
export type Catalog = z.infer<typeof catalogSchema>;
