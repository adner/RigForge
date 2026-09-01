/**
 * Client-side validation for catalog_upsert_part — the same category zod schema the
 * Worker uses, applied before the network call so the agent gets precise field issues
 * (and so `verified`, `status`, `addedBy` never even leave the page).
 */
import { z } from "zod";
import { CATEGORIES, ID_PREFIX, schemaByCategory, sourceSchema, type Category } from "../data/schema";

export interface Issue {
  path: string;
  message: string;
}
export type ValidationFailure = { ok: false; code: "INVALID_INPUT" | "VERIFIED_IS_HUMAN_ONLY"; message: string; issues: Issue[] };
export type UpsertValidation = { ok: true; part: Record<string, unknown>; category: Category } | ValidationFailure;
export type PriceValidation = { ok: true; partId: string; priceUSD: number; sourceUrl: string } | ValidationFailure;

export const isCategory = (s: unknown): s is Category => typeof s === "string" && (CATEGORIES as readonly string[]).includes(s);

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const issuesOf = (err: z.ZodError, prefix = ""): Issue[] =>
  err.issues.slice(0, 20).map((i) => {
    const p = i.path.join(".");
    return { path: prefix ? (p ? `${prefix}.${p}` : prefix) : p, message: i.message };
  });

const sourcesInput = z.array(sourceSchema).min(1, "at least one https source is required").max(5);

/** Server-controlled fields that are never forwarded from tool input. */
const SERVER_FIELDS = ["verified", "status", "addedBy", "updatedAt", "sources"] as const;

/**
 * Validates `{part, sources}` for a draft upsert. Returns the part object to send to the
 * Worker (server-set fields stripped, `sources` attached) or a structured failure.
 */
export function validateUpsertInput(input: { part?: unknown; sources?: unknown }): UpsertValidation {
  const raw = input.part;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, code: "INVALID_INPUT", message: "`part` must be an object", issues: [{ path: "part", message: "expected object" }] };
  }
  const part = { ...(raw as Record<string, unknown>) };

  if (part.verified === true) {
    return {
      ok: false,
      code: "VERIFIED_IS_HUMAN_ONLY",
      message: "`verified` can only be set by a human in the admin UI after checking the sources",
      issues: [{ path: "part.verified", message: "human-only" }],
    };
  }
  for (const k of SERVER_FIELDS) delete part[k];

  const src = sourcesInput.safeParse(input.sources ?? []);
  if (!src.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Invalid sources: at least one https source is required", issues: issuesOf(src.error, "sources") };
  }

  if (!isCategory(part.category)) {
    return { ok: false, code: "INVALID_INPUT", message: "Unknown or missing category", issues: [{ path: "part.category", message: `one of ${CATEGORIES.join(", ")}` }] };
  }
  const category = part.category;
  const now = new Date().toISOString();
  const id =
    typeof part.id === "string" && part.id ? part.id : `${ID_PREFIX[category]}-${slugify(`${String(part.brand ?? "")} ${String(part.name ?? "")}`)}`;

  // Same candidate shape the Worker builds, so the client rejects exactly what the server would.
  const candidate: Record<string, unknown> = {
    ...part,
    id,
    sources: src.data,
    status: "draft",
    verified: false,
    addedBy: "agent",
    priceUpdatedAt: typeof part.priceUpdatedAt === "string" ? part.priceUpdatedAt : now,
    updatedAt: now,
  };
  const res = schemaByCategory[category].safeParse(candidate);
  if (!res.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Part does not match the category schema", issues: issuesOf(res.error, "part") };
  }
  // Send the agent's fields + id + sources; the Worker re-applies status/verified/addedBy/timestamps.
  const toSend = { ...candidate };
  for (const k of ["status", "verified", "addedBy", "updatedAt"]) delete toSend[k];
  return { ok: true, part: toSend, category };
}

const priceSchema = z.object({
  partId: z.string().regex(/^[a-z0-9-]{1,80}$/, "malformed part id"),
  priceUSD: z.number().positive().max(20000),
  sourceUrl: sourceSchema.shape.url,
});

export function validatePriceInput(input: unknown): PriceValidation {
  const res = priceSchema.safeParse(input);
  if (!res.success) return { ok: false, code: "INVALID_INPUT", message: "Invalid price update", issues: issuesOf(res.error) };
  return { ok: true, ...res.data };
}
