/**
 * Offline part-card generator (docs/RENDER_FIDELITY.md Phase 1). Runs on the owner's machine.
 *
 *   pnpm cards --only case-fractal-terra,gpu-asus-tuf-rtx-5070-ti [--n 2] [--mode attributes] [--quality medium]
 *
 * Mode per part (unless --mode): scratchpad/refs/<id>.{png,jpg,jpeg,webp} → reference;
 * scratchpad/refs/<id>.txt → description; else attributes. Reference photos are never
 * committed or uploaded. Candidates land in scratchpad/cards/<id>/<n>.png plus
 * scratchpad/cards/contact.html for review. Publishing to R2 is a later step (--pick).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SEED_CATALOG } from "../src/data/seed";
import { GENERIC_CARD_ARCHETYPES, GENERIC_CARD_DEFINITIONS, genericCardPrompt, type GenericCardArchetype } from "../src/engine/cardArchetype";
import { CARD_CATEGORIES, CARD_MODES, cardPrompt, type CardMode } from "../src/engine/partCardPrompt";
import { downloadVendorReference, type VendorReference } from "./vendor-reference";

const ROOT = join(import.meta.dirname, "..");
const REFS = join(ROOT, "scratchpad", "refs");
const OUT = join(ROOT, "scratchpad", "cards");
const MODEL = "gpt-image-2";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = flag("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const category = flag("category");
const generic = args.includes("--generic");
const vendorFlow = args.includes("--vendor");
const referenceUrl = flag("reference-url");
const n = Number(flag("n") ?? 1);
const forcedMode = flag("mode") as CardMode | undefined;
const quality = flag("quality") ?? "high";
const help = args.includes("--help") || args.includes("-h");

if (help) {
  console.log(`Vendor reference → reviewed, brand-free part-card candidate

Usage:
  pnpm cards:vendor --only <partId> --reference-url <https-image-url> [--n 2] [--quality high]

Requirements:
  - <partId> must identify exactly one part in the catalog.
  - IMAGE_API_KEY must be set in the environment or .dev.vars.
  - The URL must return HTTPS PNG, JPEG, or WebP image bytes (maximum 20 MiB).

Output and review:
  - Candidates: scratchpad/cards/<partId>/<n>.png
  - Prompt/audit metadata: scratchpad/cards/<partId>/prompt.txt
  - Review sheet: scratchpad/cards/contact.html
  - The vendor source stays in memory and is never published or saved.
  - This command cannot publish. After human review, use:
      pnpm cards:publish --local  --pick <partId> <candidateNumber>
      pnpm cards:publish --remote --pick <partId> <candidateNumber>

Run this help:
  pnpm cards:vendor --help`);
  process.exit(0);
}
if (forcedMode && !CARD_MODES.includes(forcedMode)) throw new Error(`--mode must be one of ${CARD_MODES.join(", ")}`);
if (vendorFlow && !referenceUrl) throw new Error("cards:vendor requires --reference-url <https-url>");
if (generic && (vendorFlow || referenceUrl)) throw new Error("vendor references create specific cards and cannot be combined with --generic");

let lastUsage = "";

function readApiKey(): string {
  if (process.env.IMAGE_API_KEY) return process.env.IMAGE_API_KEY;
  const devVars = join(ROOT, ".dev.vars");
  if (existsSync(devVars)) {
    const m = readFileSync(devVars, "utf8").match(/^IMAGE_API_KEY\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1].trim();
  }
  throw new Error("IMAGE_API_KEY not set (env or .dev.vars)");
}

function findRef(id: string): { image?: string; text?: string } {
  if (!existsSync(REFS)) return {};
  const files = readdirSync(REFS).filter((f) => f.startsWith(`${id}.`));
  const image = files.find((f) => /\.(png|jpe?g|webp)$/i.test(f));
  const text = files.find((f) => f.endsWith(".txt"));
  return { image: image && join(REFS, image), text: text && join(REFS, text) };
}

type ReferenceInput = string | VendorReference;

async function callImages(prompt: string, refImage?: ReferenceInput): Promise<Uint8Array[]> {
  const apiKey = readApiKey();
  let res: Response;
  if (refImage) {
    const fd = new FormData();
    fd.set("model", MODEL);
    fd.set("prompt", prompt);
    fd.set("n", String(n));
    fd.set("size", "1024x1024");
    fd.set("quality", quality);
    fd.set("output_format", "png");
    const remote = typeof refImage !== "string";
    const ext = remote ? refImage.extension : refImage.split(".").pop()!.toLowerCase();
    const type = remote ? refImage.contentType : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const bytes = remote ? refImage.bytes : readFileSync(refImage);
    fd.append("image[]", new Blob([bytes], { type }), `ref.${ext}`);
    res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: fd });
  } else {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt, n, size: "1024x1024", quality, output_format: "png" }),
    });
  }
  if (!res.ok) throw new Error(`images API ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { image_tokens?: number; text_tokens?: number } };
  };
  if (json.usage) {
    // gpt-image-2 list price (2026-08-29): image output $30/M, image input $8/M, text input $5/M.
    const u = json.usage;
    const imgIn = u.input_tokens_details?.image_tokens ?? 0;
    const txtIn = u.input_tokens_details?.text_tokens ?? (u.input_tokens ?? 0) - imgIn;
    const usd = ((u.output_tokens ?? 0) * 30 + imgIn * 8 + txtIn * 5) / 1e6;
    lastUsage = `out ${u.output_tokens ?? "?"} tok, in ${u.input_tokens ?? "?"} tok ≈ $${usd.toFixed(3)}`;
  } else lastUsage = "";
  return (json.data ?? []).map((d) => Buffer.from(d.b64_json ?? "", "base64"));
}

async function main() {
  if (generic) return generateGenericCards();
  // Attribute/description batch generation remains scoped to the visually significant
  // render-reference categories. An explicit vendor reference can produce an exact UI
  // card for any catalog category; composition will still consume only its supported set.
  const parts = SEED_CATALOG.parts.filter(
    (p) =>
      (referenceUrl || (CARD_CATEGORIES as readonly string[]).includes(p.category)) &&
      (!only || only.includes(p.id)) &&
      (!category || p.category === category),
  );
  if (only) {
    for (const id of only) {
      if (!parts.some((p) => p.id === id)) console.warn(`! ${id}: ${referenceUrl ? "unknown part id" : "not a card category or unknown id"}`);
    }
  }
  if (!parts.length) throw new Error("no parts selected");
  if (referenceUrl && (!only || only.length !== 1)) throw new Error("--reference-url requires exactly one --only <partId>");
  if (referenceUrl && forcedMode && forcedMode !== "reference") throw new Error("--reference-url cannot be combined with a non-reference --mode");

  // The vendor source stays in memory and is discarded after the edit request. Only the
  // generated candidate and its prompt metadata are written to the git-ignored workspace.
  const remoteRef = referenceUrl ? await downloadVendorReference(referenceUrl) : undefined;
  if (remoteRef) console.log(`downloaded ${remoteRef.contentType} reference from ${remoteRef.sourceHost} (not retained)`);

  mkdirSync(OUT, { recursive: true });
  const rows: string[] = [];
  for (const p of parts) {
    const ref = findRef(p.id);
    const mode: CardMode = remoteRef ? "reference" : forcedMode ?? (ref.image ? "reference" : ref.text ? "description" : "attributes");
    const description = ref.text ? readFileSync(ref.text, "utf8") : undefined;
    const prompt = cardPrompt(p, mode, description);
    const dir = join(OUT, p.id);
    mkdirSync(dir, { recursive: true });
    const sourceMeta = remoteRef ? `\nreference-source: remote (${remoteRef.sourceHost}); vendor bytes not retained` : "";
    writeFileSync(join(dir, "prompt.txt"), `mode: ${mode}\nmodel: ${MODEL} quality: ${quality}${sourceMeta}\n\n${prompt}\n`);
    process.stdout.write(`${p.id} [${mode}] ×${n} … `);
    const t0 = Date.now();
    const images = await callImages(prompt, mode === "reference" ? remoteRef ?? ref.image : undefined);
    images.forEach((bytes, i) => writeFileSync(join(dir, `${i + 1}.png`), bytes));
    console.log(`${images.length} image(s) in ${((Date.now() - t0) / 1000).toFixed(0)} s${lastUsage ? ` · ${lastUsage}` : ""}`);
    rows.push(
      `<section><h2>${p.id} <small>${mode}</small></h2><p>${p.brand} ${p.name}</p><pre>${prompt}</pre>` +
        images.map((_, i) => `<img src="${p.id}/${i + 1}.png" width="384">`).join(" ") +
        `</section>`,
    );
  }
  writeFileSync(
    join(OUT, "contact.html"),
    `<!doctype html><meta charset="utf-8"><title>part cards</title><style>body{font:14px system-ui;margin:24px}pre{white-space:pre-wrap;color:#555;max-width:900px}section{margin-bottom:40px}</style>${rows.join("")}`,
  );
  console.log(`contact sheet: ${join(OUT, "contact.html")}`);
}

async function generateGenericCards(): Promise<void> {
  const genericOut = join(OUT, "generic");
  const selected = GENERIC_CARD_ARCHETYPES.filter(
    (archetype) => (!only || only.includes(archetype)) && (!category || GENERIC_CARD_DEFINITIONS[archetype].category === category),
  );
  if (only) for (const archetype of only) if (!GENERIC_CARD_ARCHETYPES.includes(archetype as GenericCardArchetype)) console.warn(`! ${archetype}: unknown generic archetype`);
  if (!selected.length) throw new Error("no generic archetypes selected");

  mkdirSync(genericOut, { recursive: true });
  const rows: string[] = [];
  for (const archetype of selected) {
    const definition = GENERIC_CARD_DEFINITIONS[archetype];
    const prompt = genericCardPrompt(archetype);
    const dir = join(genericOut, archetype);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "prompt.txt"), `mode: generic\narchetype: ${archetype}\nmodel: ${MODEL} quality: ${quality}\n\n${prompt}\n`);
    process.stdout.write(`${archetype} [generic] ×${n} … `);
    const t0 = Date.now();
    const images = await callImages(prompt);
    images.forEach((bytes, i) => writeFileSync(join(dir, `${i + 1}.png`), bytes));
    console.log(`${images.length} image(s) in ${((Date.now() - t0) / 1000).toFixed(0)} s${lastUsage ? ` · ${lastUsage}` : ""}`);
    rows.push(
      `<section><h2>${archetype}</h2><p>${definition.label} · ${definition.category}${definition.composeEligible ? " · render eligible" : " · thumbnail only"}</p><pre>${prompt}</pre>` +
        images.map((_, i) => `<img src="${archetype}/${i + 1}.png" width="384">`).join(" ") +
        `</section>`,
    );
  }
  writeFileSync(
    join(genericOut, "contact.html"),
    `<!doctype html><meta charset="utf-8"><title>generic part cards</title><style>body{font:14px system-ui;margin:24px}pre{white-space:pre-wrap;color:#555;max-width:900px}section{margin-bottom:40px}</style><h1>Generic part-card candidates — human review required</h1>${rows.join("")}`,
  );
  console.log(`contact sheet: ${join(genericOut, "contact.html")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
