/**
 * Deterministic render prompt (DESIGN §4.3 render_build). Built from attributes only:
 * NO brand or model names from catalog data. The optional, tightly bounded `flair` is the only
 * free-text input. The Worker bundles this file, rebuilds the prompt from ids + flair, then hashes
 * `buildHashInput` (sha256) as the cache key.
 */
import type { Category } from "../data/schema";
import { partsIn, single } from "./build";
import type { Build, Goal } from "./types";

export const RENDER_STYLES = ["photoreal", "cutaway", "studio"] as const;
export const RENDER_ANGLES = ["front", "three-quarter", "side"] as const;
export type RenderStyle = (typeof RENDER_STYLES)[number];
export type RenderAngle = (typeof RENDER_ANGLES)[number];
export const RENDER_FLAIR_MAX_LENGTH = 200;

/** Canonicalize render-only decoration text so browser and Worker produce the same hash. */
export function normalizeRenderFlair(flair: string | undefined): string | undefined {
  const normalized = flair?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

export class RenderNeedsCaseError extends Error {
  readonly code = "RENDER_NEEDS_CASE" as const;
  constructor() {
    super("a case is required to render the build");
  }
}

export function caseClass(volumeLiters: number): string {
  if (volumeLiters < 20) return "compact small-form-factor";
  if (volumeLiters <= 40) return "mid-tower";
  return "full tower";
}

export function gpuLengthClass(lengthMm: number): string {
  if (lengthMm < 240) return "short";
  if (lengthMm <= 310) return "standard-length";
  return "long";
}

const STYLE_PHRASE: Record<RenderStyle, string> = {
  photoreal: "Photorealistic product photograph",
  cutaway: "Technical cutaway illustration with the side panel removed",
  studio: "Clean studio render on a seamless neutral backdrop",
};

const ANGLE_PHRASE: Record<RenderAngle, string> = {
  front: "viewed straight from the front",
  "three-quarter": "viewed from a three-quarter front angle",
  side: "viewed from the side",
};

const COLOR_PHRASE: Record<string, string> = {
  black: "black",
  white: "white",
  silver: "silver",
  other: "neutral-toned",
};

const FRONT_PHRASE: Record<string, string> = {
  mesh: "a mesh front panel",
  solid: "a solid front panel",
  glass: "a glass front panel",
};

const TAIL = "No text, logos, brand marks or people. Neutral background, soft even lighting, sharp focus.";

function flairSentence(flair: string | undefined): string | undefined {
  const normalized = normalizeRenderFlair(flair);
  if (!normalized) return undefined;
  return `Optional decorative flair requested by the user: ${normalized}. Apply it only as a visible cosmetic detail; do not change, remove or invent PC hardware.`;
}

/** "Subtle RGB…" / "No RGB…" — the goal's lighting preference wins over the parts' own RGB. */
function lightingSentence(build: Build, goal: Goal | undefined): string {
  const cooler = single(build, "cooler");
  const anyRgb = partsIn(build, "ram").some((r) => r.hasRgb) || cooler?.hasRgb === true;
  const lighting = goal?.preferences?.lighting;
  return lighting === "rgb" || (lighting !== "none" && anyRgb) ? "Subtle RGB accent lighting inside the case." : "No RGB lighting; understated look.";
}

/** Clauses describing what sits inside the case, in a fixed order. */
function interiorClauses(build: Build): string[] {
  const gpu = single(build, "gpu");
  const cooler = single(build, "cooler");
  const sticks = partsIn(build, "ram").reduce((s, r) => s + r.sticks, 0);
  const interior: string[] = [];
  if (gpu) interior.push(`a ${gpuLengthClass(gpu.lengthMm)} dual-fan graphics card mounted horizontally`);
  if (cooler) {
    interior.push(
      cooler.type === "air"
        ? cooler.heightMm != null && cooler.heightMm < 70
          ? "a low-profile down-draft air cooler on the processor"
          : "a tower air cooler on the processor"
        : `an all-in-one liquid cooler with a ${cooler.radiatorMm} mm radiator`,
    );
  }
  if (sticks > 0) interior.push(`${sticks} memory ${sticks === 1 ? "stick" : "sticks"} beside the processor`);
  return interior;
}

/**
 * Positive, mechanically explicit installation constraints. Image models otherwise tend to
 * preserve the pose of isolated part-card references, which can produce floating coolers or a
 * GPU drawn flat against the motherboard instead of seated in its expansion slot.
 */
function mountingSentences(build: Build): string[] {
  const gpu = single(build, "gpu");
  const cooler = single(build, "cooler");
  const sentences = [
    "Use a conventional desktop-PC motherboard-tray layout unless the case reference unmistakably requires a supported riser layout; every component must be fully seated, mechanically supported, square to its mounting surface and connected only at real mounting points.",
  ];
  if (gpu) {
    sentences.push(
      "Install the graphics card directly in the motherboard PCIe slot in the standard horizontal orientation: its circuit-board plane is perpendicular to the motherboard, its rear I/O bracket is flush in the case's rear expansion slots, and its cooling fans face down toward the case floor rather than outward toward the side panel.",
    );
  }
  if (cooler?.type === "air") {
    sentences.push(
      cooler.heightMm != null && cooler.heightMm < 70
        ? "Center the low-profile CPU cooler on the processor socket with its base firmly flush against the processor; keep the heatsink and top fan level and parallel to the motherboard, secured by a symmetric mounting bracket, never tilted or floating."
        : "Center the tower CPU cooler on the processor socket with its base firmly flush against the processor; the heatsink must project straight out at 90 degrees from the motherboard and remain upright, square and securely clamped, never tilted or floating.",
    );
  } else if (cooler?.type === "aio") {
    sentences.push(
      "Center the liquid-cooler pump block flat on the processor socket and screw the radiator flush to a supported case panel, with every radiator fan aligned flat against it; no cooling part may float, tilt or intersect another component.",
    );
  }
  sentences.push("No floating, skewed, reversed, intersecting or physically impossible component geometry.");
  return sentences;
}

/**
 * Canonical prompt for the current build. Throws RenderNeedsCaseError without a case.
 * Output is stable for equal attribute sets regardless of part ids.
 */
export function renderPrompt(build: Build, goal: Goal | undefined, style: RenderStyle, angle: RenderAngle, flair?: string): string {
  const cs = single(build, "case");
  if (!cs) throw new RenderNeedsCaseError();

  const sentences: string[] = [];
  sentences.push(`${STYLE_PHRASE[style]} of a custom desktop PC, ${ANGLE_PHRASE[angle]}.`);
  sentences.push(
    `A ${COLOR_PHRASE[cs.color]} ${caseClass(cs.volumeLiters)} case of about ${Math.round(cs.volumeLiters)} liters with ${FRONT_PHRASE[cs.frontStyle]}` +
      (cs.hasWindow ? " and a tempered-glass side window showing the interior." : " and a solid side panel."),
  );
  const interior = interiorClauses(build);
  if (interior.length) sentences.push(`Inside: ${interior.join(", ")}.`);
  sentences.push(...mountingSentences(build));

  sentences.push(lightingSentence(build, goal));
  const decoration = flairSentence(flair);
  if (decoration) sentences.push(decoration);
  sentences.push(TAIL);
  return sentences.join(" ");
}

/** How each reference image is announced to the model, by the category it depicts. */
const REFERENCE_NOUN: Partial<Record<Category, string>> = {
  case: "the case",
  gpu: "the graphics card",
  cooler: "the CPU cooler",
  ram: "the memory modules",
  motherboard: "the motherboard",
  psu: "the power supply",
};

const ORDINAL = ["image 1", "image 2", "image 3", "image 4", "image 5", "image 6", "image 7", "image 8"];

/**
 * Prompt for the composed render path (docs/RENDER_FIDELITY.md Phase 2): the same scene as
 * `renderPrompt`, but the hardware comes from reference images (the build's published part
 * cards) instead of from a description. `order` lists the categories in the exact order the
 * Worker hands the images to the provider — image 1 is always the case.
 *
 * Catalog attributes remain brand/model-free; the optional render-only flair is appended as a
 * bounded cosmetic request.
 */
export function composePrompt(
  build: Build,
  goal: Goal | undefined,
  style: RenderStyle,
  angle: RenderAngle,
  order: readonly Category[],
  genericCategories: readonly Category[] = [],
  flair?: string,
): string {
  const cs = single(build, "case");
  if (!cs) throw new RenderNeedsCaseError();

  const generic = new Set(genericCategories);
  const named = order
    .slice(0, ORDINAL.length)
    .map((c, i) => `${ORDINAL[i]} is ${generic.has(c) ? "a generic archetype for " : ""}${REFERENCE_NOUN[c] ?? `the ${c}`}`);
  const sentences: string[] = [];
  sentences.push(`${STYLE_PHRASE[style]} of one custom desktop PC assembled from the reference images, ${ANGLE_PHRASE[angle]}.`);
  if (named.length) sentences.push(`Reference images: ${named.join(", ")}.`);
  sentences.push(
    "Use each reference image only for that part's appearance, shape, colour, materials, proportions and fan layout—not for its photographed pose or orientation. " +
      "Rotate every part into a physically valid installed orientation inside the case; do not redesign, restyle or rebrand it.",
  );
  if (generic.size) {
    sentences.push(
      "Generic archetype references define only the component's broad physical form; preserve their size class, fan count and cooling layout without implying a specific branded model.",
    );
  }
  const interior = interiorClauses(build);
  if (interior.length) sentences.push(`Placement: ${interior.join(", ")}.`);
  sentences.push(...mountingSentences(build));
  sentences.push(
    cs.hasWindow
      ? "Show the installed components through the tempered-glass side window."
      : "Show the interior with the side panel removed so the installed components are visible.",
  );
  sentences.push("Add nothing beyond the reference parts except the plain motherboard, power supply and cabling a complete build needs.");
  sentences.push(lightingSentence(build, goal));
  const decoration = flairSentence(flair);
  if (decoration) sentences.push(decoration);
  sentences.push(TAIL);
  return sentences.join(" ");
}

/**
 * Canonical string the Worker hashes (sha256) as the render cache key. For the text-only path it
 * is identical to the prompt by design. `cardKeys` (the R2 keys of the part cards used, in
 * provider order) selects the composed variant, so text-only and composed renders never collide
 * and republishing a card — the key is content-addressed — invalidates the cached render.
 */
export function buildHashInput(
  build: Build,
  goal: Goal | undefined,
  style: RenderStyle,
  angle: RenderAngle,
  flair?: string,
  cardKeys?: readonly string[],
): string {
  const prompt = renderPrompt(build, goal, style, angle, flair);
  return cardKeys?.length ? `${prompt}|composed|${cardKeys.join(",")}` : prompt;
}
