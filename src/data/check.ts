/**
 * `pnpm check:data` — validates the seed catalog in src/data/parts/*.json.
 *
 * 1. Every part parses against the frozen schema (reports file, index, id and zod issues).
 * 2. Referential sanity (DESIGN §6.1): sockets ↔ boards, chipsets ↔ CPU generations, DDR gens ↔ RAM,
 *    case form factors, AIO radiator sizes, PSU form factors, unique ids, per-category targets.
 * 3. Prints per-category totals and verified counts. Exits non-zero on any failure.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORIES,
  CHIPSET_SUPPORT,
  DDR_GENS,
  ID_PREFIX,
  safeParsePart,
  type Category,
  type Part,
  type PartOf,
} from "./schema";

const here = dirname(fileURLToPath(import.meta.url));
const partsDir = join(here, "parts");

/** Launch targets per category (DESIGN §6.1); each must reach ≥ 80 %. */
const TARGET: Record<Category, number> = {
  cpu: 50,
  motherboard: 60,
  ram: 40,
  gpu: 50,
  cooler: 40,
  case: 50,
  psu: 40,
  storage: 40,
};

const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

// ---------- 1. schema validation ----------

const parts: Part[] = [];
const counts: Record<Category, number> = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
const verifiedCounts: Record<Category, number> = { ...counts };

for (const category of CATEGORIES) {
  const file = `${category}.json`;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(partsDir, file), "utf8"));
  } catch (e) {
    fail(`${file}: cannot read/parse JSON (${(e as Error).message})`);
    continue;
  }
  if (!Array.isArray(raw)) {
    fail(`${file}: top level must be an array`);
    continue;
  }
  raw.forEach((entry, index) => {
    const result = safeParsePart(entry);
    const label = `${file}[${index}]${typeof entry === "object" && entry && "id" in entry ? ` (${String((entry as { id: unknown }).id)})` : ""}`;
    if (!result.success) {
      for (const issue of result.error.issues) fail(`${label}: ${issue.path.join(".") || "<root>"} — ${issue.message}`);
      return;
    }
    const part = result.data;
    if (part.category !== category) fail(`${label}: category "${part.category}" does not match file ${file}`);
    if (!part.id.startsWith(`${ID_PREFIX[category]}-`)) fail(`${label}: id must start with "${ID_PREFIX[category]}-"`);
    if (part.verified && part.sources.length === 0) fail(`${label}: verified parts must record at least one source`);
    if (part.addedBy !== "seed") fail(`${label}: seed parts must have addedBy "seed"`);
    if (part.status !== "published") fail(`${label}: seed parts must be "published"`);
    parts.push(part);
    counts[category]++;
    if (part.verified) verifiedCounts[category]++;
  });
}

const byCat = <C extends Category>(c: C) => parts.filter((p): p is PartOf<C> => p.category === c);
const cpus = byCat("cpu");
const boards = byCat("motherboard");
const rams = byCat("ram");
const gpus = byCat("gpu");
const coolers = byCat("cooler");
const cases = byCat("case");
const psus = byCat("psu");

// ---------- 2. referential checks ----------

// duplicate ids
const seen = new Map<string, number>();
for (const p of parts) seen.set(p.id, (seen.get(p.id) ?? 0) + 1);
for (const [id, n] of seen) if (n > 1) fail(`duplicate id "${id}" (${n}×)`);

// chipset table integrity
for (const b of boards) {
  if (!(b.chipset in CHIPSET_SUPPORT)) fail(`${b.id}: chipset "${b.chipset}" is not a CHIPSET_SUPPORT key`);
}
const knownGenerations = new Set(Object.values(CHIPSET_SUPPORT).flat());
for (const c of cpus) {
  if (!knownGenerations.has(c.generation)) fail(`${c.id}: generation "${c.generation}" is not in CHIPSET_SUPPORT`);
}

// every CPU socket has ≥3 boards
for (const socket of new Set(cpus.map((c) => c.socket))) {
  const n = boards.filter((b) => b.socket === socket).length;
  if (n < 3) fail(`socket ${socket}: only ${n} motherboard(s), need ≥ 3`);
}

// every board chipset supports ≥3 CPUs (same socket + generation in table)
for (const chipset of new Set(boards.map((b) => b.chipset))) {
  const socket = boards.find((b) => b.chipset === chipset)!.socket;
  const gens = CHIPSET_SUPPORT[chipset] ?? [];
  const n = cpus.filter((c) => c.socket === socket && gens.includes(c.generation)).length;
  if (n < 3) fail(`chipset ${chipset}: only ${n} supported CPU(s) on ${socket}, need ≥ 3`);
}

// every DDR gen has RAM (and a board)
for (const gen of DDR_GENS) {
  if (!rams.some((r) => r.ddrGen === gen)) fail(`DDR${gen}: no RAM kits`);
  if (!boards.some((b) => b.ddrGen === gen)) fail(`DDR${gen}: no motherboards`);
}

// every case supports ≥1 board form factor that exists
const boardFormFactors = new Set(boards.map((b) => b.formFactor));
for (const c of cases) {
  if (!c.formFactorSupport.some((ff) => boardFormFactors.has(ff)))
    fail(`${c.id}: supports no motherboard form factor present in the catalog`);
}

// every AIO radiator size is supported by ≥1 case
const radiatorSizes = new Set(cases.flatMap((c) => c.radiatorSupport));
for (const k of coolers) {
  if (k.type === "aio" && k.radiatorMm != null && !radiatorSizes.has(k.radiatorMm))
    fail(`${k.id}: ${k.radiatorMm} mm radiator is supported by no case`);
}

// every PSU form factor fits ≥1 case
const psuFormFactors = new Set(cases.flatMap((c) => c.psuFormFactor));
for (const p of psus) {
  if (!psuFormFactors.has(p.formFactor)) fail(`${p.id}: PSU form factor ${p.formFactor} fits no case`);
}

// every GPU fits ≥1 case and every air cooler fits ≥1 case (no dead parts)
const maxGpu = Math.max(...cases.map((c) => c.maxGpuLengthMm));
for (const g of gpus) if (g.lengthMm > maxGpu) fail(`${g.id}: ${g.lengthMm} mm fits no case`);
const maxCooler = Math.max(...cases.map((c) => c.maxCoolerHeightMm));
for (const k of coolers) if (k.type === "air" && (k.heightMm ?? 0) > maxCooler) fail(`${k.id}: ${k.heightMm} mm fits no case`);

// per-category counts ≥ 80 % of target
for (const category of CATEGORIES) {
  const min = Math.ceil(TARGET[category] * 0.8);
  if (counts[category] < min) fail(`${category}: ${counts[category]} parts, need ≥ ${min} (80 % of ${TARGET[category]})`);
}

// ---------- 3. report ----------

console.log("RigBuilder seed catalog check\n");
console.log("category      count  target  verified");
let total = 0;
let totalVerified = 0;
for (const category of CATEGORIES) {
  total += counts[category];
  totalVerified += verifiedCounts[category];
  console.log(
    `${category.padEnd(13)} ${String(counts[category]).padStart(5)}  ${String(TARGET[category]).padStart(6)}  ${String(verifiedCounts[category]).padStart(8)}`,
  );
}
console.log(`${"total".padEnd(13)} ${String(total).padStart(5)}  ${String(Object.values(TARGET).reduce((a, b) => a + b, 0)).padStart(6)}  ${String(totalVerified).padStart(8)}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nOK — schema and referential checks passed.");
