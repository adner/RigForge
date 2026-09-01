/**
 * Publishes human-reviewed specific or generic part-card candidates to R2 and creates the
 * lightweight WebP derivatives used by the GUI. Generation and publication stay separate:
 * running `pnpm cards` / `pnpm cards:generic` never makes an image live.
 *
 *   pnpm cards:publish --local  --pick case-fractal-terra 1
 *   pnpm cards:publish --local  --pick-generic gpu-2fan-thick 1
 *   pnpm cards:publish --remote --generic-all        # seed every reviewed generic card in assets/cards/generic
 *   pnpm cards:publish --remote --list
 *   pnpm cards:publish --remote --list-generic
 *
 * `--pick*` publishes a candidate from the git-ignored scratchpad review workspace;
 * `--generic-all` publishes the committed, already-reviewed set (assets/cards/generic/<archetype>/1.png).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { GENERIC_CARD_ARCHETYPES, isGenericCardArchetype } from "../src/engine/cardArchetype";

const ROOT = join(import.meta.dirname, "..");
const CARDS_DIR = join(ROOT, "scratchpad", "cards");
const GENERIC_DIR = join(CARDS_DIR, "generic");
/** The reviewed generic set that ships in the repo (see assets/cards/generic/README.md). */
const REVIEWED_GENERIC_DIR = join(ROOT, "assets", "cards", "generic");
const TMP = join(ROOT, "scripts", ".tmp");
const INDEX_KEY = "cards/index.json";
const GENERIC_INDEX_KEY = "cards/generic/index.json";
const CARD_SIZE = 1024;
const THUMB_SIZE = 160;

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
const remote = has("--remote");
const local = has("--local") || !remote;
const force = has("--force");
if (has("--remote") && has("--local")) fail("pass either --local or --remote, not both");

const WRANGLER_BIN = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const WINDOWS_TEARDOWN_CRASH = 3221226505;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function bucketName(): string {
  const raw = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
  const match = /"binding"\s*:\s*"RENDERS"\s*,\s*"bucket_name"\s*:\s*"([^"]+)"/.exec(raw);
  if (!match) fail("could not find the RENDERS r2 bucket_name in wrangler.jsonc");
  return match[1];
}

function wrangler(args: string[], opts: { allowFail?: boolean } = {}): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [WRANGLER_BIN, ...args], { encoding: "utf8", env: { ...process.env, CI: "1" } });
  const ok = result.status === 0 || result.status === WINDOWS_TEARDOWN_CRASH;
  if (!ok && !opts.allowFail) {
    console.error(result.stdout);
    console.error(result.stderr);
    fail(`wrangler ${args.slice(0, 3).join(" ")} failed (exit ${result.status})`);
  }
  return { ok, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const target = () => (local ? "--local" : "--remote");

interface CardEntry {
  key: string;
  thumbKey?: string;
  mode: string;
  promptHash?: string;
  reviewedAt: string;
}
type CardIndex = Record<string, CardEntry>;

function tempName(indexKey: string, suffix: string): string {
  return join(TMP, `${indexKey.replace(/[^a-z0-9]+/gi, "-")}-${suffix}.json`);
}

function readIndex(bucket: string, indexKey: string): CardIndex {
  mkdirSync(TMP, { recursive: true });
  const out = tempName(indexKey, "read");
  rmSync(out, { force: true });
  const result = wrangler(["r2", "object", "get", `${bucket}/${indexKey}`, "--file", out, target()], { allowFail: true });
  const body = existsSync(out) ? readFileSync(out, "utf8").trim() : "";
  if (!body) {
    if (!result.ok && !/not found|does not exist|404|The specified key/i.test(result.stderr + result.stdout)) {
      console.error(result.stdout);
      console.error(result.stderr);
      fail(`could not read ${indexKey}`);
    }
    return {};
  }
  try {
    return JSON.parse(body) as CardIndex;
  } catch {
    fail(`${indexKey} is not valid JSON`);
  }
}

function writeIndex(bucket: string, indexKey: string, index: CardIndex): void {
  mkdirSync(TMP, { recursive: true });
  const file = tempName(indexKey, "write");
  const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
  wrangler(["r2", "object", "put", `${bucket}/${indexKey}`, "--file", file, "--content-type", "application/json", target()]);
}

function pngSize(bytes: Buffer): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) return null;
  if (bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readPromptMeta(base: string, id: string): { mode: string; promptHash?: string } {
  const file = join(base, id, "prompt.txt");
  if (!existsSync(file)) {
    console.warn(`! ${id}: no prompt.txt next to the candidate; recording mode "unknown"`);
    return { mode: "unknown" };
  }
  const text = readFileSync(file, "utf8");
  const mode = /^mode:\s*(\S+)/m.exec(text)?.[1] ?? "unknown";
  const prompt = text.split(/\r?\n\r?\n/).slice(1).join("\n\n").trim();
  return { mode, ...(prompt ? { promptHash: createHash("sha256").update(prompt).digest("hex").slice(0, 16) } : {}) };
}

async function publishCandidate(bucket: string, id: string, candidate: string, generic: boolean): Promise<void> {
  if (generic ? !isGenericCardArchetype(id) : !/^[a-z0-9-]{1,80}$/.test(id)) fail(`"${id}" is not a valid ${generic ? "generic archetype" : "part id"}`);
  if (!/^\d+$/.test(candidate)) fail(`candidate must be a number, got "${candidate}"`);
  const base = generic ? GENERIC_DIR : CARDS_DIR;
  await publishFile(bucket, id, base, join(base, id, `${candidate}.png`), generic);
}

/** Publishes every reviewed generic card committed under assets/cards/generic (idempotent). */
async function publishAllGeneric(bucket: string): Promise<void> {
  const archetypes = GENERIC_CARD_ARCHETYPES.filter((a) => existsSync(join(REVIEWED_GENERIC_DIR, a, "1.png")));
  const missing = GENERIC_CARD_ARCHETYPES.filter((a) => !archetypes.includes(a));
  if (!archetypes.length) fail(`no reviewed generic cards found under ${REVIEWED_GENERIC_DIR}`);
  if (missing.length) console.warn(`! ${missing.length} archetype(s) have no reviewed card yet: ${missing.join(", ")}`);
  for (const archetype of archetypes) {
    await publishFile(bucket, archetype, REVIEWED_GENERIC_DIR, join(REVIEWED_GENERIC_DIR, archetype, "1.png"), true);
  }
  console.log(`done: ${archetypes.length} reviewed generic card(s) checked against ${bucket} (${target().slice(2)})`);
}

async function publishFile(bucket: string, id: string, base: string, file: string, generic: boolean): Promise<void> {
  if (!existsSync(file)) fail(`no candidate at ${file}`);
  const bytes = readFileSync(file);
  const size = pngSize(bytes);
  if (!size) fail(`${file} is not a PNG`);
  if ((size.width !== CARD_SIZE || size.height !== CARD_SIZE) && !force) {
    fail(`${file} is ${size.width}x${size.height}; cards must be ${CARD_SIZE}x${CARD_SIZE} (use --force to override)`);
  }

  const sha = createHash("sha256").update(bytes).digest("hex");
  const prefix = generic ? `cards/generic/${id}` : `cards/${id}`;
  const key = `${prefix}/${sha}.png`;
  const thumbKey = `${prefix}/${sha}.thumb.webp`;
  const indexKey = generic ? GENERIC_INDEX_KEY : INDEX_KEY;
  const index = readIndex(bucket, indexKey);
  const previous = index[id];
  if (previous?.key === key && previous.thumbKey === thumbKey) {
    console.log(`= ${id}: source and thumbnail already published (nothing to do)`);
    return;
  }

  const thumbFile = join(TMP, `${sha}.thumb.webp`);
  mkdirSync(TMP, { recursive: true });
  await sharp(bytes).resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover" }).webp({ quality: 72, effort: 4 }).toFile(thumbFile);

  if (previous?.key !== key) wrangler(["r2", "object", "put", `${bucket}/${key}`, "--file", file, "--content-type", "image/png", target()]);
  wrangler(["r2", "object", "put", `${bucket}/${thumbKey}`, "--file", thumbFile, "--content-type", "image/webp", target()]);

  const { mode, promptHash } = readPromptMeta(base, id);
  index[id] = { key, thumbKey, mode: generic ? "generic" : mode, ...(promptHash ? { promptHash } : {}), reviewedAt: new Date().toISOString() };
  writeIndex(bucket, indexKey, index);

  console.log(`+ ${id} [${generic ? "generic" : mode}] → ${key}`);
  console.log(`  thumbnail → ${thumbKey}`);
  if (previous?.key && previous.key !== key) console.log(`  replaced ${previous.key}; the old immutable object remains in place`);
  console.log(`  ${indexKey} updated (${Object.keys(index).length} card(s), ${target().slice(2)})`);
}

function list(bucket: string, generic: boolean): void {
  const indexKey = generic ? GENERIC_INDEX_KEY : INDEX_KEY;
  const index = readIndex(bucket, indexKey);
  const ids = Object.keys(index).sort();
  console.log(`${ids.length} published ${generic ? "generic " : ""}card(s) in ${bucket} (${target().slice(2)})`);
  for (const id of ids) {
    const entry = index[id];
    console.log(`  ${id.padEnd(40)} ${entry.mode.padEnd(12)} ${entry.thumbKey ? "thumb ✓" : "thumb —"}  ${entry.reviewedAt ?? ""}`);
  }
}

async function main(): Promise<void> {
  const bucket = bucketName();
  if (has("--list")) return list(bucket, false);
  if (has("--list-generic")) return list(bucket, true);
  if (has("--generic-all")) return publishAllGeneric(bucket);

  const generic = has("--pick-generic");
  const flag = generic ? "--pick-generic" : "--pick";
  const index = argv.indexOf(flag);
  if (index < 0) {
    console.log("usage: pnpm cards:publish [--local|--remote] --pick <partId> <n>");
    console.log("       pnpm cards:publish [--local|--remote] --pick-generic <archetype> <n>");
    console.log("       pnpm cards:publish [--local|--remote] --generic-all");
    console.log("       pnpm cards:publish [--local|--remote] --list | --list-generic");
    process.exit(2);
  }
  const [id, candidate] = [argv[index + 1], argv[index + 2]];
  if (!id || !candidate) fail(`${flag} needs an id and candidate number`);
  await publishCandidate(bucket, id, candidate, generic);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
