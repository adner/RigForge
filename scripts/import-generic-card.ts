/** Import one built-in ImageGen result into the generic-card review workspace. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { GENERIC_CARD_DEFINITIONS, genericCardPrompt, isGenericCardArchetype } from "../src/engine/cardArchetype";
import type { GenericCardArchetype } from "../src/engine/cardArchetype";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "scratchpad", "cards", "generic");
const [archetype, sourceArg] = process.argv.slice(2);
if (!isGenericCardArchetype(archetype) || !sourceArg) throw new Error("usage: pnpm cards:generic:import <archetype> <generated-image.png>");
const source = resolve(sourceArg);
if (!existsSync(source)) throw new Error(`generated image not found: ${source}`);

const dir = join(OUT, archetype);
mkdirSync(dir, { recursive: true });
const prompt = genericCardPrompt(archetype);
await sharp(source).resize(1024, 1024, { fit: "cover", position: "centre" }).png().toFile(join(dir, "1.png"));
writeFileSync(join(dir, "prompt.txt"), `mode: generic\narchetype: ${archetype}\nmodel: built-in-imagegen\n\n${prompt}\n`);

const rows = readdirSync(OUT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && isGenericCardArchetype(entry.name) && existsSync(join(OUT, entry.name, "1.png")))
  .map((entry) => {
    const key = entry.name as GenericCardArchetype;
    const definition = GENERIC_CARD_DEFINITIONS[key];
    const savedPrompt = existsSync(join(OUT, key, "prompt.txt")) ? readFileSync(join(OUT, key, "prompt.txt"), "utf8") : "";
    return `<section><h2>${key}</h2><p>${definition.label} · ${definition.category}${definition.composeEligible ? " · render eligible" : " · thumbnail only"}</p><img src="${key}/1.png" width="384"><pre>${savedPrompt}</pre></section>`;
  });
writeFileSync(
  join(OUT, "contact.html"),
  `<!doctype html><meta charset="utf-8"><title>generic part cards</title><style>body{font:14px system-ui;margin:24px;background:#f4f4f4}section{margin:0 0 40px;padding:16px;background:white}pre{white-space:pre-wrap;color:#555;max-width:900px}</style><h1>Generic part-card candidates — human review required</h1><p>${rows.length} of ${Object.keys(GENERIC_CARD_DEFINITIONS).length} candidates generated. Reject any glyph, mark, label, wrong fan/module count, or implausible form.</p>${rows.join("")}`,
);
console.log(`imported ${archetype} → ${join(dir, "1.png")}`);
console.log(`review sheet → ${join(OUT, "contact.html")}`);
