import { describe, expect, it } from "vitest";
import { SEED_CATALOG } from "../data/seed";
import {
  GENERIC_CARD_ARCHETYPES,
  GENERIC_CARD_DEFINITIONS,
  defaultGenericCardArchetype,
  genericCardArchetype,
  genericCardPrompt,
  isGenericCardArchetype,
} from "./cardArchetype";

describe("generic card archetypes", () => {
  it("defines the reviewed-library target of 38 brand-free archetypes", () => {
    expect(GENERIC_CARD_ARCHETYPES).toHaveLength(38);
    expect(new Set(GENERIC_CARD_ARCHETYPES).size).toBe(38);
    for (const key of GENERIC_CARD_ARCHETYPES) {
      expect(isGenericCardArchetype(key)).toBe(true);
      expect(genericCardPrompt(key)).toContain(GENERIC_CARD_DEFINITIONS[key].description);
      expect(genericCardPrompt(key)).toMatch(/No text.*logos/i);
    }
    expect(isGenericCardArchetype("../../renders/secret")).toBe(false);
  });

  it("maps every current catalog part deterministically to its own category", () => {
    for (const part of SEED_CATALOG.parts) {
      const key = genericCardArchetype(part);
      expect(isGenericCardArchetype(key), part.id).toBe(true);
      expect(GENERIC_CARD_DEFINITIONS[key].category, part.id).toBe(part.category);
      expect(genericCardArchetype(part), part.id).toBe(key);
    }
  });

  it("provides a category-only default for compact admin summaries", () => {
    for (const part of SEED_CATALOG.parts) {
      const key = defaultGenericCardArchetype(part.category);
      expect(GENERIC_CARD_DEFINITIONS[key].category).toBe(part.category);
    }
  });

  it("allows generic composition only for internal visual categories", () => {
    const eligible = new Set(GENERIC_CARD_ARCHETYPES.filter((key) => GENERIC_CARD_DEFINITIONS[key].composeEligible).map((key) => GENERIC_CARD_DEFINITIONS[key].category));
    expect(eligible).toEqual(new Set(["gpu", "cooler", "ram"]));
  });
});
