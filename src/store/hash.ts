/**
 * Build hash for render artifacts: sha256 (hex) of the engine's canonical `buildHashInput` string.
 * WebCrypto in the browser and Node ≥ 20 (globalThis.crypto.subtle).
 */
import { buildHashInput, type Build, type Goal, type RenderAngle, type RenderStyle } from "../engine";

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Throws RenderNeedsCaseError (from the engine) when the build has no case. */
export function hashBuild(build: Build, goal: Goal | undefined, style: RenderStyle, angle: RenderAngle, flair?: string): Promise<string> {
  return sha256Hex(buildHashInput(build, goal, style, angle, flair));
}
