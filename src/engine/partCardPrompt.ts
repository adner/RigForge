/**
 * Prompts for offline "part cards" (docs/RENDER_FIDELITY.md Phase 1): one brand-free studio
 * image per visually significant part. Pure; no network. Three modes:
 *   - reference:   a vendor photo is supplied to the edits endpoint (never shipped)
 *   - description: a reviewed, offline-only free-text visual description
 *   - attributes:  catalog fields only (same discipline as renderPrompt.ts)
 */
import type { Part } from "../data/schema";
import { caseClass, gpuLengthClass } from "./renderPrompt";

export const CARD_MODES = ["reference", "description", "attributes"] as const;
export type CardMode = (typeof CARD_MODES)[number];

export const CARD_CATEGORIES = ["case", "gpu", "cooler", "ram"] as const;

const NOUN: Record<string, string> = {
  cpu: "desktop processor",
  motherboard: "desktop PC motherboard",
  ram: "set of desktop memory modules",
  gpu: "graphics card",
  cooler: "CPU cooler",
  case: "desktop PC case",
  psu: "desktop PC power supply",
  storage: "internal solid-state drive",
};

/**
 * Common tail. The subject clause is per-part so a multi-stick memory kit is not collapsed
 * into a single module by "single product only".
 */
function tail(p: Part): string {
  const subject =
    p.category === "ram" && p.sticks > 1
      ? `All ${p.sticks} memory modules of the kit, standing upright side by side`
      : "Single product only";
  return (
    `${subject}, centred, isolated on a seamless neutral light-grey studio backdrop, ` +
    "three-quarter front view, soft even lighting, sharp focus, photorealistic. " +
    "No text, logos, badges, stickers, packaging, cables, hands or people."
  );
}

const NO_BRANDING = "Omit all branding: no logos, wordmarks, model names or badges anywhere on the product.";

/** Attribute-only sentence for a part; falls back to a generic noun for other categories. */
export function attributeSentence(p: Part): string {
  switch (p.category) {
    case "case": {
      const color = p.color === "other" ? "neutral-toned" : p.color;
      const window = p.hasWindow ? "a tempered-glass side window" : "a solid side panel";
      const front = { mesh: "a mesh front panel", solid: "a solid front panel", glass: "a glass front panel" }[p.frontStyle];
      const ff = p.formFactorSupport.includes("ATX") ? "" : p.formFactorSupport.includes("mATX") ? " micro-ATX" : " mini-ITX";
      return `A ${color} ${caseClass(p.volumeLiters)}${ff} ${NOUN.case} of about ${Math.round(p.volumeLiters)} liters with ${front} and ${window}.`;
    }
    case "gpu": {
      const fans = p.lengthMm < 220 ? "single-fan" : p.lengthMm < 290 ? "dual-fan" : "triple-fan";
      const thick = p.slots >= 3.5 ? "very thick" : p.slots >= 2.5 ? "thick" : "slim";
      return `A ${gpuLengthClass(p.lengthMm)} ${fans}, ${thick} ${NOUN.gpu} (about ${p.lengthMm} mm long, ${p.slots} slots) with a dark shroud and a metal backplate, shown fan side up.`;
    }
    case "cooler":
      return p.type === "air"
        ? `A ${p.heightMm && p.heightMm < 70 ? "low-profile" : p.heightMm && p.heightMm > 155 ? "large dual-tower" : "single-tower"} air ${NOUN.cooler} about ${p.heightMm} mm tall with a fan${p.hasRgb ? " and subtle RGB lighting" : ""}.`
        : `An all-in-one liquid ${NOUN.cooler} with a ${p.radiatorMm} mm radiator, ${p.radiatorMm! / 120 === 1 ? "one fan" : `${Math.round(p.radiatorMm! / 120)} fans`}, tubing and a pump block${p.hasRgb ? " with subtle RGB lighting" : ""}.`;
    case "ram":
      return `A ${NOUN.ram}: ${p.sticks} DDR${p.ddrGen} sticks standing upright side by side with ${p.hasRgb ? "RGB light bars on top of the heat spreaders" : "plain matte heat spreaders"}.`;
    default:
      return `A ${p.category} PC component.`;
  }
}

export function cardPrompt(p: Part, mode: CardMode, description?: string): string {
  const noun = NOUN[p.category] ?? "PC component";
  switch (mode) {
    case "reference":
      return `Recreate the ${noun} shown in the reference image in a new studio setting, keeping its exact shape, proportions, materials, colours, fan layout and panel details. ${NO_BRANDING} ${tail(p)}`;
    case "description":
      if (!description?.trim()) throw new Error("description mode needs a description");
      return `${description.trim().replace(/\s+/g, " ")} ${NO_BRANDING} ${tail(p)}`;
    case "attributes":
      return `${attributeSentence(p)} ${NO_BRANDING} ${tail(p)}`;
  }
}
