/**
 * Deterministic, brand-free fallback card archetypes.
 *
 * Specific part cards always win. These archetypes provide:
 *   - a visually honest thumbnail when a part has no reviewed specific card; and
 *   - broad GPU/cooler/RAM references for composed renders whose case has a specific card.
 *
 * The resolver uses catalog attributes only. Keep it pure: the browser, Worker, offline
 * generator and tests all depend on producing the same key for the same part.
 */
import type { Category, Part } from "../data/schema";

export interface GenericCardDefinition {
  category: Category;
  label: string;
  description: string;
  /** Generic cards from these categories may be fed to composed rendering. */
  composeEligible: boolean;
}

export const GENERIC_CARD_DEFINITIONS = {
  "case-sff-mesh-solid": { category: "case", label: "SFF mesh case", description: "a compact small-form-factor desktop PC case with ventilated mesh panels and no glass window", composeEligible: false },
  "case-sff-mesh-window": { category: "case", label: "SFF mesh window case", description: "a compact small-form-factor desktop PC case with ventilated mesh panels and one clear side window", composeEligible: false },
  "case-sff-solid-solid": { category: "case", label: "SFF solid case", description: "a compact small-form-factor desktop PC case with clean solid front and side panels", composeEligible: false },
  "case-sff-solid-window": { category: "case", label: "SFF solid window case", description: "a compact small-form-factor desktop PC case with a clean solid front and one clear side window", composeEligible: false },
  "case-mid-mesh-solid": { category: "case", label: "Mid-tower mesh case", description: "a dark mid-tower desktop PC case with a ventilated mesh front and a solid side panel", composeEligible: false },
  "case-mid-mesh-window": { category: "case", label: "Mid-tower mesh window case", description: "a dark mid-tower desktop PC case with a ventilated mesh front and one clear side window", composeEligible: false },
  "case-mid-solid-solid": { category: "case", label: "Mid-tower solid case", description: "a dark mid-tower desktop PC case with clean solid front and side panels", composeEligible: false },
  "case-full-glass-window": { category: "case", label: "Full-tower glass case", description: "a large full-tower desktop PC case with a glass front panel and one clear side window", composeEligible: false },
  "case-full-mesh-solid": { category: "case", label: "Full-tower mesh case", description: "a large full-tower desktop PC case with a ventilated mesh front and a solid side panel", composeEligible: false },
  "case-full-mesh-window": { category: "case", label: "Full-tower mesh window case", description: "a large full-tower desktop PC case with a ventilated mesh front and one clear side window", composeEligible: false },
  "case-full-solid-solid": { category: "case", label: "Full-tower solid case", description: "a large full-tower desktop PC case with clean solid front and side panels", composeEligible: false },

  "gpu-1fan-slim": { category: "gpu", label: "Compact single-fan GPU", description: "a short, slim desktop graphics card with one cooling fan, a dark neutral shroud and a plain metal backplate", composeEligible: true },
  "gpu-2fan-slim": { category: "gpu", label: "Slim dual-fan GPU", description: "a slim desktop graphics card with two cooling fans, a dark neutral shroud and a plain metal backplate", composeEligible: true },
  "gpu-2fan-thick": { category: "gpu", label: "Thick dual-fan GPU", description: "a thick desktop graphics card with two cooling fans, a dark neutral shroud and a plain metal backplate", composeEligible: true },
  "gpu-3fan-slim": { category: "gpu", label: "Slim triple-fan GPU", description: "a long but slim desktop graphics card with three cooling fans, a dark neutral shroud and a plain metal backplate", composeEligible: true },
  "gpu-3fan-thick": { category: "gpu", label: "Thick triple-fan GPU", description: "a long, thick desktop graphics card with three cooling fans, a dark neutral shroud and a plain metal backplate", composeEligible: true },
  "gpu-3fan-xl": { category: "gpu", label: "Extra-thick triple-fan GPU", description: "a very large extra-thick desktop graphics card with three cooling fans, a dark neutral shroud and a plain metal backplate", composeEligible: true },

  "cooler-air-low": { category: "cooler", label: "Low-profile air cooler", description: "a low-profile down-draft desktop CPU air cooler with one horizontal fan over a compact metal heatsink", composeEligible: true },
  "cooler-air-tower": { category: "cooler", label: "Tower air cooler", description: "a single-tower desktop CPU air cooler with one vertical fan and a metal fin stack", composeEligible: true },
  "cooler-air-large": { category: "cooler", label: "Large tower air cooler", description: "a large dual-tower desktop CPU air cooler with two vertical fans and two metal fin stacks", composeEligible: true },
  "cooler-aio-120": { category: "cooler", label: "120 mm liquid cooler", description: "an all-in-one desktop CPU liquid cooler with a 120 mm radiator, one fan, two flexible tubes and a plain pump block", composeEligible: true },
  "cooler-aio-240": { category: "cooler", label: "240 mm liquid cooler", description: "an all-in-one desktop CPU liquid cooler with a 240 mm radiator, two fans, two flexible tubes and a plain pump block", composeEligible: true },
  "cooler-aio-280": { category: "cooler", label: "280 mm liquid cooler", description: "an all-in-one desktop CPU liquid cooler with a 280 mm radiator, two large fans, two flexible tubes and a plain pump block", composeEligible: true },
  "cooler-aio-360": { category: "cooler", label: "360 mm liquid cooler", description: "an all-in-one desktop CPU liquid cooler with a 360 mm radiator, three fans, two flexible tubes and a plain pump block", composeEligible: true },
  "cooler-aio-420": { category: "cooler", label: "420 mm liquid cooler", description: "an all-in-one desktop CPU liquid cooler with a 420 mm radiator, three large fans, two flexible tubes and a plain pump block", composeEligible: true },

  "ram-2-plain": { category: "ram", label: "Two memory modules", description: "two desktop memory modules with plain dark matte heat spreaders, standing upright side by side", composeEligible: true },
  "ram-2-rgb": { category: "ram", label: "Two RGB memory modules", description: "two desktop memory modules with dark heat spreaders and simple diffused RGB light bars, standing upright side by side", composeEligible: true },
  "ram-4-plain": { category: "ram", label: "Four memory modules", description: "four desktop memory modules with plain dark matte heat spreaders, standing upright side by side", composeEligible: true },
  "ram-4-rgb": { category: "ram", label: "Four RGB memory modules", description: "four desktop memory modules with dark heat spreaders and simple diffused RGB light bars, standing upright side by side", composeEligible: true },

  "cpu-desktop": { category: "cpu", label: "Desktop processor", description: "a modern square desktop computer processor with a plain brushed-metal heat spreader and an unmarked dark substrate", composeEligible: false },
  "motherboard-itx": { category: "motherboard", label: "Mini-ITX motherboard", description: "a compact square mini-ITX desktop motherboard with a neutral dark circuit board, processor socket, two memory slots and one expansion slot", composeEligible: false },
  "motherboard-matx": { category: "motherboard", label: "Micro-ATX motherboard", description: "a micro-ATX desktop motherboard with a neutral dark circuit board, processor socket, four memory slots and several expansion slots", composeEligible: false },
  "motherboard-atx": { category: "motherboard", label: "ATX motherboard", description: "a full-size ATX desktop motherboard with a neutral dark circuit board, processor socket, four memory slots and several expansion slots", composeEligible: false },
  "psu-atx": { category: "psu", label: "ATX power supply", description: "a standard rectangular ATX desktop computer power supply with a dark metal enclosure, one cooling fan and plain modular cable sockets", composeEligible: false },
  "psu-sfx": { category: "psu", label: "SFX power supply", description: "a compact SFX desktop computer power supply with a dark metal enclosure, one cooling fan and plain modular cable sockets", composeEligible: false },
  "psu-sfx-l": { category: "psu", label: "SFX-L power supply", description: "an elongated compact SFX-L desktop computer power supply with a dark metal enclosure, one cooling fan and plain modular cable sockets", composeEligible: false },
  "storage-m2": { category: "storage", label: "M.2 storage drive", description: "a slim M.2 solid-state storage module with a dark bare circuit board and memory chips", composeEligible: false },
  "storage-sata": { category: "storage", label: "SATA storage drive", description: "a slim 2.5-inch SATA solid-state storage drive in a plain dark metal enclosure", composeEligible: false },
} as const satisfies Record<string, GenericCardDefinition>;

export type GenericCardArchetype = keyof typeof GENERIC_CARD_DEFINITIONS;
export const GENERIC_CARD_ARCHETYPES = Object.keys(GENERIC_CARD_DEFINITIONS) as GenericCardArchetype[];

export const isGenericCardArchetype = (value: unknown): value is GenericCardArchetype =>
  typeof value === "string" && Object.hasOwn(GENERIC_CARD_DEFINITIONS, value);

const caseSize = (liters: number): "sff" | "mid" | "full" => (liters < 20 ? "sff" : liters <= 40 ? "mid" : "full");

export function genericCardArchetype(part: Part): GenericCardArchetype {
  switch (part.category) {
    case "case": {
      const size = caseSize(part.volumeLiters);
      const panel = part.frontStyle === "glass" ? "glass" : part.frontStyle;
      const side = part.hasWindow ? "window" : "solid";
      const exact = `case-${size}-${panel}-${side}`;
      if (isGenericCardArchetype(exact)) return exact;
      // Future catalog combinations map to the nearest reviewed silhouette.
      if (size === "sff") return part.hasWindow ? "case-sff-solid-window" : "case-sff-solid-solid";
      if (size === "mid") return part.hasWindow ? "case-mid-mesh-window" : "case-mid-solid-solid";
      return part.hasWindow ? "case-full-mesh-window" : "case-full-solid-solid";
    }
    case "gpu": {
      const fans = part.lengthMm < 220 ? 1 : part.lengthMm < 290 ? 2 : 3;
      if (fans === 1) return "gpu-1fan-slim";
      if (fans === 2) return part.slots >= 2.5 ? "gpu-2fan-thick" : "gpu-2fan-slim";
      return part.slots >= 3.5 ? "gpu-3fan-xl" : part.slots >= 2.5 ? "gpu-3fan-thick" : "gpu-3fan-slim";
    }
    case "cooler": {
      if (part.type === "air") {
        return part.heightMm! < 70 ? "cooler-air-low" : part.heightMm! > 155 ? "cooler-air-large" : "cooler-air-tower";
      }
      if (part.radiatorMm! <= 140) return "cooler-aio-120";
      if (part.radiatorMm === 240) return "cooler-aio-240";
      if (part.radiatorMm === 280) return "cooler-aio-280";
      if (part.radiatorMm === 360) return "cooler-aio-360";
      return "cooler-aio-420";
    }
    case "ram":
      return part.sticks <= 2 ? (part.hasRgb ? "ram-2-rgb" : "ram-2-plain") : part.hasRgb ? "ram-4-rgb" : "ram-4-plain";
    case "cpu":
      return "cpu-desktop";
    case "motherboard":
      return part.formFactor === "ITX" ? "motherboard-itx" : part.formFactor === "mATX" ? "motherboard-matx" : "motherboard-atx";
    case "psu":
      return part.formFactor === "SFX" ? "psu-sfx" : part.formFactor === "SFX-L" ? "psu-sfx-l" : "psu-atx";
    case "storage":
      return part.interface === "m2-nvme" ? "storage-m2" : "storage-sata";
  }
}

export const defaultGenericCardArchetype = (category: Category): GenericCardArchetype =>
  ({
    cpu: "cpu-desktop",
    motherboard: "motherboard-atx",
    ram: "ram-2-plain",
    gpu: "gpu-3fan-thick",
    cooler: "cooler-air-tower",
    case: "case-mid-mesh-window",
    psu: "psu-atx",
    storage: "storage-m2",
  })[category] as GenericCardArchetype;

export function genericCardPrompt(archetype: GenericCardArchetype): string {
  const definition = GENERIC_CARD_DEFINITIONS[archetype];
  return (
    `A brand-neutral generic example of ${definition.description}. ` +
    "Single product or complete matched kit only, centred and filling most of the frame, isolated on a seamless neutral light-grey studio backdrop, three-quarter front view, soft even lighting, sharp focus, photorealistic product photography. " +
    "No text, letters, numbers, logos, wordmarks, model names, badges, stickers, labels, packaging, cables, hands or people."
  );
}
