import { describe, expect, it } from "vitest";
import * as F from "./__fixtures__/parts";
import { buildFromParts, withPart } from "./build";
import { RENDER_ANGLES, RENDER_STYLES, RenderNeedsCaseError, buildHashInput, caseClass, composePrompt, gpuLengthClass, renderPrompt } from "./renderPrompt";
import type { Goal } from "./types";

const good = buildFromParts(F.GOOD_PARTS);
const goal: Goal = { useCase: "gaming", budgetUSD: 2500, preferences: { lighting: "rgb" } };

describe("renderPrompt", () => {
  it("classifies case volume and GPU length", () => {
    expect(caseClass(15)).toBe("compact small-form-factor");
    expect(caseClass(40)).toBe("mid-tower");
    expect(caseClass(62)).toBe("full tower");
    expect(gpuLengthClass(200)).toBe("short");
    expect(gpuLengthClass(300)).toBe("standard-length");
    expect(gpuLengthClass(358)).toBe("long");
  });

  it("snapshot: photoreal three-quarter, RGB preference", () => {
    expect(renderPrompt(good, goal, "photoreal", "three-quarter")).toMatchInlineSnapshot(
      `"Photorealistic product photograph of a custom desktop PC, viewed from a three-quarter front angle. A black mid-tower case of about 40 liters with a mesh front panel and a tempered-glass side window showing the interior. Inside: a standard-length dual-fan graphics card mounted horizontally, a tower air cooler on the processor, 2 memory sticks beside the processor. Use a conventional desktop-PC motherboard-tray layout unless the case reference unmistakably requires a supported riser layout; every component must be fully seated, mechanically supported, square to its mounting surface and connected only at real mounting points. Install the graphics card directly in the motherboard PCIe slot in the standard horizontal orientation: its circuit-board plane is perpendicular to the motherboard, its rear I/O bracket is flush in the case's rear expansion slots, and its cooling fans face down toward the case floor rather than outward toward the side panel. Center the tower CPU cooler on the processor socket with its base firmly flush against the processor; the heatsink must project straight out at 90 degrees from the motherboard and remain upright, square and securely clamped, never tilted or floating. No floating, skewed, reversed, intersecting or physically impossible component geometry. Subtle RGB accent lighting inside the case. No text, logos, brand marks or people. Neutral background, soft even lighting, sharp focus."`,
    );
  });

  it("snapshot: cutaway side, SFF with AIO, no lighting", () => {
    const sff = buildFromParts([F.cpu9800x3d, F.mbB850Itx, F.ramDdr5_6000_2x16Rgb, F.gpu5060, F.coolerAio240, F.caseItx15l, F.psuSfx750Platinum]);
    expect(renderPrompt(sff, { useCase: "gaming", budgetUSD: 1, preferences: { lighting: "none" } }, "cutaway", "side")).toMatchInlineSnapshot(
      `"Technical cutaway illustration with the side panel removed of a custom desktop PC, viewed from the side. A black compact small-form-factor case of about 15 liters with a solid front panel and a solid side panel. Inside: a short dual-fan graphics card mounted horizontally, an all-in-one liquid cooler with a 240 mm radiator, 2 memory sticks beside the processor. Use a conventional desktop-PC motherboard-tray layout unless the case reference unmistakably requires a supported riser layout; every component must be fully seated, mechanically supported, square to its mounting surface and connected only at real mounting points. Install the graphics card directly in the motherboard PCIe slot in the standard horizontal orientation: its circuit-board plane is perpendicular to the motherboard, its rear I/O bracket is flush in the case's rear expansion slots, and its cooling fans face down toward the case floor rather than outward toward the side panel. Center the liquid-cooler pump block flat on the processor socket and screw the radiator flush to a supported case panel, with every radiator fan aligned flat against it; no cooling part may float, tilt or intersect another component. No floating, skewed, reversed, intersecting or physically impossible component geometry. No RGB lighting; understated look. No text, logos, brand marks or people. Neutral background, soft even lighting, sharp focus."`,
    );
  });

  it("never contains a brand or model name from the fixtures (both prompt modes)", () => {
    const builds = [good, withPart(good, F.caseMidAtxWhiteGlass, { replace: true }), withPart(good, F.coolerAio360, { replace: true })];
    const tokens = new Set<string>();
    for (const p of F.FIXTURE_PARTS) {
      tokens.add(p.brand.toLowerCase());
      tokens.add(p.name.toLowerCase());
      for (const w of p.name.toLowerCase().split(/\s+/)) if (w.length >= 4 && !/^\d+(gb|tb|w)?$/.test(w)) tokens.add(w);
      tokens.add(p.id);
    }
    // Generic English words that also appear in fixture names are fine ("black", "white", "compact", "pro" is not in prompt).
    for (const g of ["black", "white", "compact", "budget", "mesh", "north", "liquid"]) tokens.delete(g);
    for (const b of builds)
      for (const style of RENDER_STYLES)
        for (const angle of RENDER_ANGLES)
          for (const prompt of [renderPrompt(b, goal, style, angle), composePrompt(b, goal, style, angle, ["case", "gpu", "cooler", "ram"])]) {
            const lower = prompt.toLowerCase();
            for (const t of tokens) expect(lower, `prompt leaks "${t}"`).not.toContain(t);
          }
  });

  it("is deterministic and attribute-based (same attributes, different part ids → same prompt)", () => {
    const a = renderPrompt(good, goal, "studio", "front");
    const b = renderPrompt(withPart(good, F.ramDdr5_6400_2x32, { replacesPartId: "ram-ddr5-6000-2x16" }), goal, "studio", "front");
    expect(a).toBe(b);
    expect(buildHashInput(good, goal, "studio", "front")).toBe(a);
  });

  it("lighting: RGB parts imply lighting unless the goal says none", () => {
    const rgb = withPart(good, F.ramDdr5_6000_2x16Rgb, { replace: true });
    expect(renderPrompt(rgb, undefined, "studio", "front")).toContain("Subtle RGB accent lighting");
    expect(renderPrompt(rgb, { useCase: "gaming", budgetUSD: 1, preferences: { lighting: "none" } }, "studio", "front")).toContain("No RGB lighting");
    expect(renderPrompt(good, undefined, "studio", "front")).toContain("No RGB lighting");
  });

  it("throws RENDER_NEEDS_CASE without a case", () => {
    expect(() => renderPrompt(buildFromParts([F.cpu9800x3d]), goal, "studio", "front")).toThrow(RenderNeedsCaseError);
  });
});

describe("composePrompt (part-card composition, docs/RENDER_FIDELITY.md Phase 2)", () => {
  it("snapshot: photoreal three-quarter with all four cards", () => {
    expect(composePrompt(good, goal, "photoreal", "three-quarter", ["case", "gpu", "cooler", "ram"])).toMatchInlineSnapshot(
      `"Photorealistic product photograph of one custom desktop PC assembled from the reference images, viewed from a three-quarter front angle. Reference images: image 1 is the case, image 2 is the graphics card, image 3 is the CPU cooler, image 4 is the memory modules. Use each reference image only for that part's appearance, shape, colour, materials, proportions and fan layout—not for its photographed pose or orientation. Rotate every part into a physically valid installed orientation inside the case; do not redesign, restyle or rebrand it. Placement: a standard-length dual-fan graphics card mounted horizontally, a tower air cooler on the processor, 2 memory sticks beside the processor. Use a conventional desktop-PC motherboard-tray layout unless the case reference unmistakably requires a supported riser layout; every component must be fully seated, mechanically supported, square to its mounting surface and connected only at real mounting points. Install the graphics card directly in the motherboard PCIe slot in the standard horizontal orientation: its circuit-board plane is perpendicular to the motherboard, its rear I/O bracket is flush in the case's rear expansion slots, and its cooling fans face down toward the case floor rather than outward toward the side panel. Center the tower CPU cooler on the processor socket with its base firmly flush against the processor; the heatsink must project straight out at 90 degrees from the motherboard and remain upright, square and securely clamped, never tilted or floating. No floating, skewed, reversed, intersecting or physically impossible component geometry. Show the installed components through the tempered-glass side window. Add nothing beyond the reference parts except the plain motherboard, power supply and cabling a complete build needs. Subtle RGB accent lighting inside the case. No text, logos, brand marks or people. Neutral background, soft even lighting, sharp focus."`,
    );
  });

  it("snapshot: SFF without a window → the side panel is removed so the parts stay visible", () => {
    const sff = buildFromParts([F.cpu9800x3d, F.mbB850Itx, F.ramDdr5_6000_2x16Rgb, F.gpu5060, F.coolerAio240, F.caseItx15l, F.psuSfx750Platinum]);
    expect(composePrompt(sff, { useCase: "gaming", budgetUSD: 1, preferences: { lighting: "none" } }, "cutaway", "side", ["case", "gpu", "cooler", "ram"])).toMatchInlineSnapshot(
      `"Technical cutaway illustration with the side panel removed of one custom desktop PC assembled from the reference images, viewed from the side. Reference images: image 1 is the case, image 2 is the graphics card, image 3 is the CPU cooler, image 4 is the memory modules. Use each reference image only for that part's appearance, shape, colour, materials, proportions and fan layout—not for its photographed pose or orientation. Rotate every part into a physically valid installed orientation inside the case; do not redesign, restyle or rebrand it. Placement: a short dual-fan graphics card mounted horizontally, an all-in-one liquid cooler with a 240 mm radiator, 2 memory sticks beside the processor. Use a conventional desktop-PC motherboard-tray layout unless the case reference unmistakably requires a supported riser layout; every component must be fully seated, mechanically supported, square to its mounting surface and connected only at real mounting points. Install the graphics card directly in the motherboard PCIe slot in the standard horizontal orientation: its circuit-board plane is perpendicular to the motherboard, its rear I/O bracket is flush in the case's rear expansion slots, and its cooling fans face down toward the case floor rather than outward toward the side panel. Center the liquid-cooler pump block flat on the processor socket and screw the radiator flush to a supported case panel, with every radiator fan aligned flat against it; no cooling part may float, tilt or intersect another component. No floating, skewed, reversed, intersecting or physically impossible component geometry. Show the interior with the side panel removed so the installed components are visible. Add nothing beyond the reference parts except the plain motherboard, power supply and cabling a complete build needs. No RGB lighting; understated look. No text, logos, brand marks or people. Neutral background, soft even lighting, sharp focus."`,
    );
  });

  it("names exactly the images it is given, in order", () => {
    const p = composePrompt(good, goal, "studio", "front", ["case", "gpu"]);
    expect(p).toContain("Reference images: image 1 is the case, image 2 is the graphics card.");
    expect(p).not.toContain("image 3");
    expect(composePrompt(good, goal, "studio", "front", ["case", "cooler", "gpu"])).toContain("image 2 is the CPU cooler, image 3 is the graphics card");
  });

  it("requires physically valid CPU-cooler and GPU mounting in both render modes", () => {
    for (const prompt of [renderPrompt(good, goal, "studio", "three-quarter"), composePrompt(good, goal, "studio", "three-quarter", ["case", "gpu", "cooler", "ram"])]) {
      expect(prompt).toContain("circuit-board plane is perpendicular to the motherboard");
      expect(prompt).toContain("rear I/O bracket is flush in the case's rear expansion slots");
      expect(prompt).toContain("cooling fans face down toward the case floor");
      expect(prompt).toContain("heatsink must project straight out at 90 degrees from the motherboard");
      expect(prompt).toContain("No floating, skewed, reversed, intersecting or physically impossible component geometry");
    }
    const lowProfile = withPart(good, F.coolerLowProfile47, { replace: true });
    expect(renderPrompt(lowProfile, goal, "photoreal", "side")).toContain("top fan level and parallel to the motherboard");
    const aio = withPart(good, F.coolerAio360, { replace: true });
    expect(renderPrompt(aio, goal, "photoreal", "side")).toContain("pump block flat on the processor socket");
  });

  it("treats composition references as appearance references, not installation poses", () => {
    const prompt = composePrompt(good, goal, "studio", "three-quarter", ["case", "gpu", "cooler", "ram"]);
    expect(prompt).toContain("not for its photographed pose or orientation");
    expect(prompt).toContain("Rotate every part into a physically valid installed orientation");
  });

  it("adds bounded render flair as a cosmetic detail and makes it part of the hash", () => {
    const flair = "a small illustrated turtle sticker on the glass side panel";
    const prompt = renderPrompt(good, goal, "studio", "side", flair);
    expect(prompt).toContain(`Optional decorative flair requested by the user: ${flair}.`);
    expect(prompt).toContain("do not change, remove or invent PC hardware");
    expect(buildHashInput(good, goal, "studio", "side", flair)).toBe(prompt);
    expect(buildHashInput(good, goal, "studio", "side", flair)).not.toBe(buildHashInput(good, goal, "studio", "side"));
  });

  it("labels generic references as broad archetypes without changing specific references", () => {
    const p = composePrompt(good, goal, "studio", "front", ["case", "gpu", "ram"], ["gpu", "ram"]);
    expect(p).toContain("image 1 is the case");
    expect(p).toContain("image 2 is a generic archetype for the graphics card");
    expect(p).toContain("image 3 is a generic archetype for the memory modules");
    expect(p).toContain("broad physical form");
  });

  it("throws RENDER_NEEDS_CASE without a case", () => {
    expect(() => composePrompt(buildFromParts([F.cpu9800x3d]), goal, "studio", "front", ["case"])).toThrow(RenderNeedsCaseError);
  });
});

describe("buildHashInput", () => {
  it("is the plain prompt for the text path and a distinct composed variant with card keys", () => {
    const text = buildHashInput(good, goal, "studio", "front");
    expect(text).toBe(renderPrompt(good, goal, "studio", "front"));
    expect(buildHashInput(good, goal, "studio", "front", undefined, [])).toBe(text);

    const keys = ["cards/case-a/1.png", "cards/gpu-a/2.png"];
    const composed = buildHashInput(good, goal, "studio", "front", undefined, keys);
    expect(composed).toBe(`${text}|composed|${keys.join(",")}`);
    expect(composed).not.toBe(text);
    // A republished (content-addressed) card changes the key and therefore the cache key.
    expect(buildHashInput(good, goal, "studio", "front", undefined, ["cards/case-a/9.png", keys[1]])).not.toBe(composed);
  });
});
