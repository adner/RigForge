/**
 * Bundled seed catalog — imported into D1 by `pnpm catalog:import` and used as the
 * offline fallback when /api/catalog is unreachable (DESIGN §6.1).
 *
 * Source of truth for the seed is `src/data/parts/*.json` (curated by hand, provenance in
 * `src/data/SOURCES.md`). `pnpm check:data` validates the same files plus referential rules;
 * the parse below is a last line of defence so a broken seed fails loudly at module load.
 */
import { catalogSchema, type Catalog } from "./schema";
import cpu from "./parts/cpu.json";
import motherboard from "./parts/motherboard.json";
import ram from "./parts/ram.json";
import gpu from "./parts/gpu.json";
import cooler from "./parts/cooler.json";
import caseParts from "./parts/case.json";
import psu from "./parts/psu.json";
import storage from "./parts/storage.json";

const SNAPSHOT_DATE = "2026-08-29";
const CATALOG_VERSION = 1;

const rawParts: unknown[] = [...cpu, ...motherboard, ...ram, ...gpu, ...cooler, ...caseParts, ...psu, ...storage];

const parsed = catalogSchema.safeParse({
  catalogVersion: CATALOG_VERSION,
  snapshotDate: SNAPSHOT_DATE,
  parts: rawParts,
});

if (!parsed.success) {
  const first = parsed.error.issues.slice(0, 5).map((i) => `  ${i.path.join(".")}: ${i.message}`);
  throw new Error(
    `SEED_CATALOG failed schema validation (${parsed.error.issues.length} issue(s)). ` +
      `Run \`pnpm check:data\` for a per-part report. First issues:\n${first.join("\n")}`,
  );
}

export const SEED_CATALOG: Catalog = parsed.data;
