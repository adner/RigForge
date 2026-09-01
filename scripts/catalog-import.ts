/**
 * Seed → D1 importer (DESIGN.md §6.1).  `pnpm catalog:import [--remote] [--force] [--dry-run] [--reset]`
 *
 * `--reset` (also `pnpm catalog:reset[:remote]`) wipes parts, catalog_versions and change_log
 * first, so the catalog comes back exactly as the seed: v1, no drafts, no agent-added parts,
 * a single seed log row. Use before every full demo rehearsal (docs/DEMO.md §0). Renders (R2)
 * and share links (KV) are content-addressed and deliberately left alone.
 *
 * 1. Validates SEED_CATALOG with catalogSchema (fails loudly, prints the first issues).
 * 2. Generates idempotent upsert SQL (ON CONFLICT(id, status) DO UPDATE), batched into files.
 * 3. Runs them through `wrangler d1 execute CATALOG --local|--remote --file`.
 * 4. Inserts a catalog_versions row (max+1, or 1) unless the seed hash is unchanged
 *    since the last import (re-running with identical data is a no-op; use --force).
 *
 * Migrations are applied separately by `pnpm catalog:migrate [--remote]`.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { catalogSchema, type Part } from "../src/data/schema";
import { SEED_CATALOG } from "../src/data/seed";

const args = new Set(process.argv.slice(2));
const target = args.has("--remote") ? "--remote" : "--local";
const reset = args.has("--reset");
const force = args.has("--force") || reset;
const dryRun = args.has("--dry-run");
const BINDING = "CATALOG";
const BATCH = 100;
const tmpDir = join(process.cwd(), "scripts", ".tmp");

const q = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
};

const upsertSql = (p: Part): string =>
  `INSERT INTO parts (id, status, category, verified, added_by, price_usd, price_updated_at, updated_at, spec_json) VALUES (` +
  [p.id, p.status, p.category, p.verified, p.addedBy, p.priceUSD, p.priceUpdatedAt, p.updatedAt, JSON.stringify(p)].map(q).join(", ") +
  `) ON CONFLICT(id, status) DO UPDATE SET category = excluded.category, verified = excluded.verified, added_by = excluded.added_by, ` +
  `price_usd = excluded.price_usd, price_updated_at = excluded.price_updated_at, updated_at = excluded.updated_at, spec_json = excluded.spec_json;`;

interface D1Result {
  results?: Array<Record<string, unknown>>;
}

const WRANGLER_BIN = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
/** workerd occasionally aborts on teardown on Windows (0xC0000409) after the work completed. */
const WINDOWS_TEARDOWN_CRASH = 3221226505;

function wrangler(argv: string[]): D1Result[] {
  const res = spawnSync(process.execPath, [WRANGLER_BIN, ...argv], { encoding: "utf8", env: { ...process.env, CI: "1" } });
  const succeeded = res.status === 0 || (res.status === WINDOWS_TEARDOWN_CRASH && /executed successfully|"success": true/.test(res.stdout));
  if (!succeeded) {
    console.error(res.stdout);
    console.error(res.stderr);
    throw new Error(`wrangler ${argv.slice(0, 3).join(" ")} failed (exit ${res.status})`);
  }
  const jsonStart = res.stdout.indexOf("[");
  if (!argv.includes("--json") || jsonStart < 0) return [];
  return JSON.parse(res.stdout.slice(jsonStart)) as D1Result[];
}

const d1 = (extra: string[]) => wrangler(["d1", "execute", BINDING, target, ...extra]);

function main(): void {
  const parsed = catalogSchema.safeParse(SEED_CATALOG);
  if (!parsed.success) {
    console.error("SEED_CATALOG is invalid:");
    for (const i of parsed.error.issues.slice(0, 20)) console.error(`  ${i.path.join(".")}: ${i.message}`);
    process.exit(1);
  }
  const seed = parsed.data;
  const parts = seed.parts.map((p) => ({ ...p, status: "published" as const }));
  const byCategory = parts.reduce<Record<string, number>>((acc, p) => ((acc[p.category] = (acc[p.category] ?? 0) + 1), acc), {});
  const hash = createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
  console.log(`Seed: ${parts.length} parts, snapshot ${seed.snapshotDate}, hash ${hash}, target ${target}`);
  console.log(`  ${Object.entries(byCategory).map(([c, n]) => `${c}=${n}`).join(" ") || "(empty)"}`);

  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const files: string[] = [];
  for (let i = 0; i < parts.length; i += BATCH) {
    const file = join(tmpDir, `import-${String(i / BATCH).padStart(3, "0")}.sql`);
    writeFileSync(file, parts.slice(i, i + BATCH).map(upsertSql).join("\n") + "\n");
    files.push(file);
  }
  if (dryRun) {
    console.log(`--dry-run: wrote ${files.length} SQL batch file(s) to ${tmpDir}; nothing executed.`);
    return;
  }

  if (reset) {
    const file = join(tmpDir, "reset.sql");
    const stmts = ["DELETE FROM parts;", "DELETE FROM catalog_versions;", "DELETE FROM change_log;", "DELETE FROM sqlite_sequence WHERE name = 'change_log';", ""];
    writeFileSync(file, stmts.join(String.fromCharCode(10)));
    d1(["--file", file]);
    console.log(`--reset: wiped parts, catalog_versions and change_log (${target}).`);
  }

  const [verRes] = d1(["--json", "--command", "SELECT version, summary FROM catalog_versions ORDER BY version DESC LIMIT 1"]);
  const latest = verRes?.results?.[0] as { version?: number; summary?: string } | undefined;
  const maxVersion = Number(latest?.version ?? 0);
  const unchanged = latest?.summary?.includes(`seed:${hash}`) ?? false;

  for (const file of files) {
    d1(["--file", file]);
    console.log(`  applied ${file}`);
  }

  if (unchanged && !force) {
    console.log(`Seed unchanged since v${maxVersion} — parts upserted, version not bumped (use --force to bump).`);
  } else {
    const version = maxVersion + 1;
    const now = new Date().toISOString();
    const summary = `seed import: ${parts.length} parts (seed:${hash})`;
    const sql =
      `INSERT INTO catalog_versions (version, published_at, snapshot_date, summary) VALUES (${version}, ${q(now)}, ${q(seed.snapshotDate)}, ${q(summary)});\n` +
      `INSERT INTO change_log (at, actor, action, part_id, detail) VALUES (${q(now)}, 'seed', 'import', NULL, ${q(`v${version}: ${summary}`)});\n`;
    const file = join(tmpDir, "version.sql");
    writeFileSync(file, sql);
    d1(["--file", file]);
    console.log(`Published catalog v${version}.`);
  }

  const [countRes] = d1(["--json", "--command", "SELECT status, COUNT(*) AS n FROM parts GROUP BY status"]);
  const rows = countRes?.results ?? [];
  console.log(rows.length ? rows.map((r) => `  ${r.status}: ${r.n}`).join("\n") : "  parts: 0");
  rmSync(tmpDir, { recursive: true, force: true });
}

main();
