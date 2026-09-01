import { describe, expect, it } from "vitest";
import * as F from "../engine/__fixtures__/parts";
import { emptyBuild, withPart } from "../engine";
import { partSelectionIntent } from "./partSelection";

const buildWith = (parts: typeof F.GOOD_PARTS) => parts.reduce((build, part) => withPart(build, part), emptyBuild());

describe("partSelectionIntent", () => {
  it("allows a compatible empty-slot selection without confirmation", () => {
    expect(partSelectionIntent(F.cpu9800x3d, emptyBuild())).toEqual({ replace: false });
  });

  it("asks before a compatible replacement", () => {
    const build = withPart(emptyBuild(), F.cpu9800x3d);
    expect(partSelectionIntent(F.cpu9600x, build)).toEqual({
      replace: true,
      confirmation: `Replace ${F.cpu9800x3d.name} with ${F.cpu9600x.name}?`,
    });
  });

  it("lists engine blockers but still permits an incompatible human swap", () => {
    const intent = partSelectionIntent(F.caseItx12l, buildWith(F.GOOD_PARTS));

    expect(intent.replace).toBe(true);
    expect(intent.confirmation).toContain(`${F.caseItx12l.name} won't fit the current build`);
    expect(intent.confirmation).toContain("motherboard is ATX, case supports ITX");
    expect(intent.confirmation).toContain("cooler is 165 mm tall, case max 55 mm");
    expect(intent.confirmation).toContain("PSU is ATX, case accepts SFX");
    expect(intent.confirmation).toMatch(/Swap anyway\?$/);
  });
});
