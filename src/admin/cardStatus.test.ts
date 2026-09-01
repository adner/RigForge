import { describe, expect, it } from "vitest";
import { resolveIndexedCardKind } from "./cardStatus";

describe("admin card status", () => {
  it("prefers a part-specific image when both indexes can satisfy the row", () => {
    expect(resolveIndexedCardKind("gpu-x", "gpu-2fan-slim", new Set(["gpu-x"]), new Set(["gpu-2fan-slim"]))).toBe("specific");
  });

  it("falls back to generic and then none", () => {
    expect(resolveIndexedCardKind("gpu-x", "gpu-2fan-slim", new Set(), new Set(["gpu-2fan-slim"]))).toBe("generic");
    expect(resolveIndexedCardKind("gpu-x", "gpu-2fan-slim", new Set(), new Set())).toBe("none");
  });
});
