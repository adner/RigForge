/**
 * Share payload helpers (DESIGN §7.2): `#b=<base64url({v:1, parts, goal})>`.
 * Version-checked, ≤ 2 KB, unknown ids dropped with a notice, malformed → friendly error.
 */
import { z } from "zod";
import { WORKLOADS } from "../data/schema";
import type { Build, CatalogIndex, Goal } from "../engine";
import { allParts } from "../engine";

export const SHARE_MAX_BYTES = 2048;
export const SHARE_FRAGMENT_KEY = "b";

export const goalSchema = z
  .object({
    useCase: z.enum(WORKLOADS),
    budgetUSD: z.number().positive().max(100000),
    preferences: z
      .object({
        noise: z.enum(["quiet", "standard"]).optional(),
        size: z.enum(["compact", "standard", "any"]).optional(),
        lighting: z.enum(["rgb", "none", "any"]).optional(),
        color: z.enum(["black", "white", "any"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const sharePayloadSchema = z
  .object({
    v: z.literal(1),
    parts: z.array(z.string().max(80)).max(32),
    goal: goalSchema.optional(),
  })
  .strict();

export interface SharePayload {
  v: 1;
  parts: string[];
  goal?: Goal;
}

export function payloadFromBuild(build: Build, goal?: Goal): SharePayload {
  const p: SharePayload = { v: 1, parts: allParts(build).map((x) => x.id) };
  if (goal) p.goal = goal;
  return p;
}

// ---------- base64url ----------

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** Compact JSON → base64url. Throws if the payload exceeds SHARE_MAX_BYTES. */
export function encodeShare(payload: SharePayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > SHARE_MAX_BYTES) throw new Error(`share payload is ${bytes.byteLength} bytes; limit ${SHARE_MAX_BYTES}`);
  return toBase64Url(bytes);
}

export type DecodeResult =
  | { ok: true; payload: SharePayload }
  | { ok: false; code: "EMPTY" | "TOO_LARGE" | "MALFORMED" | "UNSUPPORTED_VERSION"; message: string };

export function decodeShare(encoded: string): DecodeResult {
  const s = encoded.trim();
  if (!s) return { ok: false, code: "EMPTY", message: "no share payload" };
  if (s.length > Math.ceil((SHARE_MAX_BYTES * 4) / 3) + 4) {
    return { ok: false, code: "TOO_LARGE", message: `share payload exceeds ${SHARE_MAX_BYTES} bytes` };
  }
  let raw: unknown;
  try {
    const bytes = fromBase64Url(s);
    if (bytes.byteLength > SHARE_MAX_BYTES) return { ok: false, code: "TOO_LARGE", message: `share payload exceeds ${SHARE_MAX_BYTES} bytes` };
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, code: "MALFORMED", message: "this share link is malformed and could not be read" };
  }
  if (typeof raw === "object" && raw !== null && "v" in raw && (raw as { v: unknown }).v !== 1) {
    return { ok: false, code: "UNSUPPORTED_VERSION", message: `unsupported share payload version ${String((raw as { v: unknown }).v)}` };
  }
  const parsed = sharePayloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "MALFORMED", message: "this share link is malformed and could not be read" };
  return { ok: true, payload: parsed.data as SharePayload };
}

/** Resolves ids against a catalog; unknown ids are dropped and reported. */
export function resolveSharedParts(payload: SharePayload, catalog: CatalogIndex): { partIds: string[]; unknownIds: string[]; notice?: string } {
  const partIds: string[] = [];
  const unknownIds: string[] = [];
  for (const id of payload.parts) (catalog.byId.has(id) ? partIds : unknownIds).push(id);
  const notice = unknownIds.length ? `${unknownIds.length} part(s) not in this catalog were dropped: ${unknownIds.join(", ")}` : undefined;
  return { partIds, unknownIds, notice };
}

/** Reads `#b=` from a fragment string (with or without the leading '#'). */
export function shareFromFragment(fragment: string): string | null {
  const f = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const params = new URLSearchParams(f);
  return params.get(SHARE_FRAGMENT_KEY);
}

export function fragmentForPayload(payload: SharePayload): string {
  return `#${SHARE_FRAGMENT_KEY}=${encodeShare(payload)}`;
}
