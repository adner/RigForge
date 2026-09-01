/**
 * /api/admin/* — Access-gated catalog writes (DESIGN.md §4.7, §8, §9).
 *
 *   GET  /api/admin/parts?status=&category=&q=&full=1
 *   GET  /api/admin/parts/:id                 published + draft rows for diffing
 *   GET  /api/admin/schema/:category          JSON Schema (from zod)
 *   GET  /api/admin/log?limit=&before=        change_log, newest first (cursor = `at`)
 *   GET  /api/admin/card-status               reviewed card-index availability (no R2 keys)
 *   POST /api/admin/parts                     upsert DRAFT {part, addedBy?, note?}
 *   POST /api/admin/parts/:id/price           {priceUSD, sourceUrl?, addedBy?}
 *   POST /api/admin/parts/:id/verify          HUMAN ONLY: admin-UI header + Access JWT
 *   POST /api/admin/parts/:id/discard         drop the draft
 *   POST /api/admin/publish                   {confirm:true, partIds?, actor?}
 *
 * Every route requires a valid `Cf-Access-Jwt-Assertion` unless DEV_ADMIN_BYPASS=1.
 * Agents can never set `verified`; the verify route is the one human-only path and
 * additionally requires the `X-RigBuilder-Admin-UI` header that only the admin UI sends.
 * The WebMCP admin tools never call it.
 */
import { z } from "zod";
import {
  CATEGORIES,
  ID_PREFIX,
  partSchema,
  schemaByCategory,
  sourceSchema,
  type Category,
  type Part,
} from "../src/data/schema";
import { verifyAccessJwt, type AccessConfig } from "./access";
import type { CardStore } from "./card-store";
import { ApiError, ok, readJsonBody } from "./http";
import { CHANGE_LOG_DEFAULT_LIMIT, CHANGE_LOG_MAX_LIMIT, type Actor, type CatalogRepo, type StatusFilter } from "./repo";

export const ADMIN_UI_HEADER = "x-rigbuilder-admin-ui";

export interface AdminContext {
  repo: CatalogRepo;
  /** Reviewed card indexes. Null/undefined when R2 is not configured. */
  cards?: CardStore | null;
  /** null = auth bypassed (local dev only). */
  access: AccessConfig | null;
  /** Normalized emails with full mutation rights. Empty in production means safe contributor-only mode. */
  ownerEmails?: readonly string[];
  now?: () => Date;
  fetchFn?: typeof fetch;
}

const writerRole = z.enum(["agent", "human"]);
const isoNow = (ctx: AdminContext) => (ctx.now ?? (() => new Date()))().toISOString();
const today = (ctx: AdminContext) => isoNow(ctx).slice(0, 10);
/** Keep audit identities useful without exposing full email addresses to every admin viewer. */
export const maskIdentity = (identity: string): string => {
  const at = identity.lastIndexOf("@");
  if (at < 1) return identity.startsWith("access:") ? `${identity.slice(0, 14)}…` : "authenticated user";
  const local = identity.slice(0, at);
  const domain = identity.slice(at + 1);
  return `${local[0]}${"*".repeat(Math.min(3, Math.max(1, local.length - 1)))}@${domain}`;
};

const zodDetails = (err: z.ZodError) =>
  err.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message }));

const parseOr400 = <S extends z.ZodType>(schema: S, input: unknown, code = "VALIDATION"): z.output<S> => {
  const res = schema.safeParse(input);
  if (!res.success) throw new ApiError(400, code, "Validation failed", zodDetails(res.error));
  return res.data as z.output<S>;
};

const isCategory = (s: string): s is Category => (CATEGORIES as readonly string[]).includes(s);

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const summary = (p: Part) => ({
  id: p.id,
  name: p.name,
  brand: p.brand,
  category: p.category,
  priceUSD: p.priceUSD,
  verified: p.verified,
  status: p.status,
  addedBy: p.addedBy,
  updatedAt: p.updatedAt,
});

/** Shallow field diff between two parts (for the admin table). */
export const diffParts = (before: Part | null, after: Part): Array<{ field: string; before: unknown; after: unknown }> => {
  if (!before) return [{ field: "*", before: null, after: "new part" }];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const k of keys) {
    if (k === "updatedAt" || k === "status") continue;
    const a = (before as Record<string, unknown>)[k];
    const b = (after as Record<string, unknown>)[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: k, before: a, after: b });
  }
  return out;
};

// ---------- auth ----------

type AdminRole = "owner" | "contributor";
interface AdminPrincipal { identity: string | null; role: AdminRole }

async function authenticate(request: Request, ctx: AdminContext): Promise<AdminPrincipal> {
  if (ctx.access === null) return { identity: null, role: "owner" }; // DEV_ADMIN_BYPASS
  const claims = await verifyAccessJwt(request.headers.get("cf-access-jwt-assertion"), ctx.access, ctx.fetchFn ?? fetch, (ctx.now ?? (() => new Date()))().getTime());
  let identity: string;
  if (typeof claims.email === "string" && claims.email.length <= 320) identity = claims.email.trim().toLowerCase();
  else if (typeof claims.sub === "string" && claims.sub.length <= 200) identity = `access:${claims.sub}`;
  else throw new ApiError(401, "UNAUTHORIZED", "Access token has no accountable identity");
  const owners = new Set((ctx.ownerEmails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean));
  return { identity, role: owners.has(identity) ? "owner" : "contributor" };
}

const requireOwner = (principal: AdminPrincipal, operation: string) => {
  if (principal.role !== "owner") throw new ApiError(403, "FORBIDDEN", `${operation} is restricted to catalog owners`);
};

// ---------- route handlers ----------

const upsertBody = z.object({
  part: z.record(z.string(), z.unknown()),
  addedBy: writerRole.default("agent"),
  note: z.string().max(200).optional(),
});

async function upsertDraft(request: Request, ctx: AdminContext, principal: AdminPrincipal): Promise<Response> {
  const body = parseOr400(upsertBody, await readJsonBody(request));
  const raw = body.part;
  if (raw.verified === true) {
    throw new ApiError(400, "VERIFIED_IS_HUMAN_ONLY", "`verified` can only be set by a human in the admin UI");
  }
  const category = typeof raw.category === "string" && isCategory(raw.category) ? raw.category : null;
  if (!category) throw new ApiError(400, "VALIDATION", "Validation failed", [{ path: "category", message: "unknown category" }]);

  const now = isoNow(ctx);
  const id =
    typeof raw.id === "string" && raw.id
      ? raw.id
      : `${ID_PREFIX[category]}-${slugify(`${String(raw.brand ?? "")} ${String(raw.name ?? "")}`)}`;

  const candidate = {
    ...raw,
    id,
    status: "draft",
    verified: false,
    addedBy: body.addedBy,
    priceUpdatedAt: typeof raw.priceUpdatedAt === "string" ? raw.priceUpdatedAt : now,
    updatedAt: now,
  };
  const part = parseOr400(schemaByCategory[category], candidate) as Part;
  // The category schema already enforces plain text on name/brand; belt-and-braces:
  parseOr400(partSchema, part);

  const published = await ctx.repo.getPart(part.id, "published");
  if (published && principal.role !== "owner") {
    throw new ApiError(403, "FORBIDDEN", "Contributor access can add new parts but cannot update a published part");
  }
  if (published && published.category !== part.category) {
    throw new ApiError(409, "CATEGORY_MISMATCH", `Part ${part.id} exists as ${published.category}`);
  }
  await ctx.repo.upsertPart(part);
  await ctx.repo.appendLog({
    at: now,
    actor: body.addedBy,
    identity: principal.identity,
    action: published ? "draft_update" : "draft_create",
    partId: part.id,
    detail: body.note ?? null,
  });
  return ok({ partId: part.id, status: "draft", validation: { ok: true, issues: [] }, diff: diffParts(published, part) });
}

const priceBody = z.object({
  priceUSD: z.number().positive().max(20000),
  sourceUrl: sourceSchema.shape.url.optional(),
  addedBy: writerRole.default("agent"),
});

/** Returns the draft for `id`, creating it from the published row if needed. */
async function draftFor(ctx: AdminContext, id: string): Promise<Part> {
  const draft = await ctx.repo.getPart(id, "draft");
  if (draft) return draft;
  const published = await ctx.repo.getPart(id, "published");
  if (!published) throw new ApiError(404, "NOT_FOUND", `No part ${id}`);
  return { ...published, status: "draft" };
}

async function updatePrice(request: Request, ctx: AdminContext, id: string, principal: AdminPrincipal): Promise<Response> {
  const body = parseOr400(priceBody, await readJsonBody(request));
  const now = isoNow(ctx);
  if (principal.role !== "owner" && (await ctx.repo.getPart(id, "published"))) {
    throw new ApiError(403, "FORBIDDEN", "Contributor access cannot change the price of a published part");
  }
  const base = await draftFor(ctx, id);
  const sources = [...base.sources];
  if (body.sourceUrl && !sources.some((s) => s.url === body.sourceUrl)) {
    sources.push({ url: body.sourceUrl });
    while (sources.length > 5) sources.shift();
  }
  const draft = parseOr400(partSchema, {
    ...base,
    priceUSD: body.priceUSD,
    priceUpdatedAt: now,
    updatedAt: now,
    sources,
    // A price edit does not re-verify a part, but keeps prior human verification.
  });
  await ctx.repo.upsertPart(draft);
  await ctx.repo.appendLog({ at: now, actor: body.addedBy, identity: principal.identity, action: "draft_price", partId: id, detail: String(body.priceUSD) });
  const published = await ctx.repo.getPart(id, "published");
  return ok({ partId: id, status: "draft", diff: diffParts(published, draft) });
}

const verifyBody = z.object({ verified: z.boolean().default(true) });

async function verifyPart(request: Request, ctx: AdminContext, id: string, principal: AdminPrincipal): Promise<Response> {
  requireOwner(principal, "Verification");
  if (request.headers.get(ADMIN_UI_HEADER) !== "1") {
    throw new ApiError(403, "VERIFIED_IS_HUMAN_ONLY", "Verification is only available from the admin UI");
  }
  const body = parseOr400(verifyBody, await readJsonBody(request));
  const now = isoNow(ctx);
  const base = await draftFor(ctx, id);
  const draft = parseOr400(partSchema, { ...base, verified: body.verified, updatedAt: now });
  await ctx.repo.upsertPart(draft);
  await ctx.repo.appendLog({ at: now, actor: "human", identity: principal.identity, action: body.verified ? "verify" : "unverify", partId: id });
  return ok({ partId: id, status: "draft", verified: body.verified });
}

async function discardDraft(ctx: AdminContext, id: string, principal: AdminPrincipal): Promise<Response> {
  if (principal.role !== "owner" && (await ctx.repo.getPart(id, "published"))) {
    throw new ApiError(403, "FORBIDDEN", "Contributor access cannot discard a draft for a published part");
  }
  const removed = await ctx.repo.deletePart(id, "draft");
  if (!removed) throw new ApiError(404, "NOT_FOUND", `No draft for ${id}`);
  await ctx.repo.appendLog({ at: isoNow(ctx), actor: "human", identity: principal.identity, action: "discard", partId: id });
  return ok({ partId: id, discarded: true });
}

const publishBody = z.object({
  confirm: z.literal(true),
  partIds: z.array(z.string().max(80)).max(500).optional(),
  actor: writerRole.default("agent"),
});

async function publish(request: Request, ctx: AdminContext, principal: AdminPrincipal): Promise<Response> {
  const body = parseOr400(publishBody, await readJsonBody(request), "CONFIRM_REQUIRED");
  let partIds = body.partIds;
  if (principal.role !== "owner") {
    const drafts = await ctx.repo.listParts({ status: "draft" });
    const requested = partIds ? drafts.filter((draft) => partIds!.includes(draft.id)) : drafts;
    const checks = await Promise.all(requested.map(async (draft) => ({ id: draft.id, published: Boolean(await ctx.repo.getPart(draft.id, "published")) })));
    const forbidden = checks.filter((item) => item.published).map((item) => item.id);
    // An explicit request containing protected ids is rejected. An unscoped "publish"
    // safely publishes only new additions and leaves any owner's update drafts alone.
    if (body.partIds && forbidden.length) throw new ApiError(403, "FORBIDDEN", "Contributor access cannot publish updates to existing parts", { partIds: forbidden });
    partIds = checks.filter((item) => !item.published).map((item) => item.id);
    if (!partIds.length) throw new ApiError(400, "VALIDATION", "There are no new-part drafts eligible for contributor publishing");
  }
  const result = await ctx.repo.publish({
    partIds,
    actor: body.actor as Actor,
    identity: principal.identity,
    snapshotDate: today(ctx),
    now: isoNow(ctx),
  });
  return ok({ catalogVersion: result.version, published: result.publishedIds.length, partIds: result.publishedIds });
}

const listQuery = z.object({
  status: z.enum(["published", "draft", "all"]).default("all"),
  category: z.enum(CATEGORIES).optional(),
  q: z.string().max(80).optional(),
  full: z.enum(["1", "0"]).default("0"),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

async function listParts(url: URL, ctx: AdminContext): Promise<Response> {
  const q = parseOr400(listQuery, Object.fromEntries(url.searchParams));
  const parts = await ctx.repo.listParts({ status: q.status as StatusFilter, category: q.category, q: q.q, limit: q.limit });
  return ok({ count: parts.length, parts: q.full === "1" ? parts : parts.map(summary) });
}

async function getPart(ctx: AdminContext, id: string): Promise<Response> {
  const [published, draft] = await Promise.all([ctx.repo.getPart(id, "published"), ctx.repo.getPart(id, "draft")]);
  if (!published && !draft) throw new ApiError(404, "NOT_FOUND", `No part ${id}`);
  return ok({ partId: id, published, draft, diff: draft ? diffParts(published, draft) : [] });
}

const logQuery = z.object({
  limit: z.coerce.number().int().min(1).max(CHANGE_LOG_MAX_LIMIT).default(CHANGE_LOG_DEFAULT_LIMIT),
  before: z.string().datetime({ offset: true }).optional(),
});

/** Newest first. `nextBefore` is the cursor for the next page (null when this page was short). */
async function listChangeLog(url: URL, ctx: AdminContext): Promise<Response> {
  const q = parseOr400(logQuery, Object.fromEntries(url.searchParams));
  const entries = (await ctx.repo.listChangeLog({ limit: q.limit, before: q.before })).map((entry) => ({
    ...entry,
    identity: entry.identity ? maskIdentity(entry.identity) : null,
  }));
  const nextBefore = entries.length === q.limit ? entries[entries.length - 1].at : null;
  return ok({ entries, nextBefore });
}

/**
 * A compact, Access-gated view of the two reviewed indexes for the admin table.
 * The browser needs only membership, never the content-addressed R2 keys. It combines
 * these sets with each row's deterministic archetype; a specific id always wins.
 */
async function getCardStatus(ctx: AdminContext): Promise<Response> {
  if (!ctx.cards) throw new ApiError(503, "CARD_UNAVAILABLE", "Part-card storage is not configured");
  const [specific, generic] = await Promise.all([ctx.cards.index(), ctx.cards.genericIndex()]);
  return ok({
    specificPartIds: Object.keys(specific).filter((id) => Boolean(specific[id]?.thumbKey)).sort(),
    genericArchetypes: Object.entries(generic).flatMap(([archetype, entry]) => (entry?.thumbKey ? [archetype] : [])).sort(),
  });
}

export const jsonSchemaFor = (category: Category): Record<string, unknown> =>
  z.toJSONSchema(schemaByCategory[category], { unrepresentable: "any", io: "input" }) as Record<string, unknown>;

const FIELD_NOTES: Record<string, string> = {
  units: "lengths mm, power W, clocks MHz, capacity GB, prices USD",
  id: "optional on create; format <prefix>-<slug>, prefixes: " + Object.values(ID_PREFIX).join(", "),
  text: "name <= 80 and brand <= 40 chars, plain text only (no URLs, markup or newlines)",
  sources: "https URLs only, max 5; record the spec page you took the values from",
  verified: "server-controlled; agents cannot set it",
};

function getSchema(category: string): Response {
  if (!isCategory(category)) throw new ApiError(404, "NOT_FOUND", `Unknown category ${category}`);
  return ok({ category, schema: jsonSchemaFor(category), notes: FIELD_NOTES });
}

// ---------- router ----------

const ID_RE = /^[a-z0-9-]{1,80}$/;

export async function handleAdmin(request: Request, url: URL, ctx: AdminContext): Promise<Response> {
  const principal = await authenticate(request, ctx);
  const segs = url.pathname.replace(/^\/api\/admin\/?/, "").split("/").filter(Boolean);
  const method = request.method;

  if (segs[0] === "session" && segs.length === 1 && method === "GET") {
    return ok({ identity: principal.identity ?? "local development", accountable: principal.identity !== null, role: principal.role });
  }

  if (segs[0] === "schema" && segs.length === 2 && method === "GET") return getSchema(segs[1]);

  if (segs[0] === "log" && segs.length === 1 && method === "GET") return listChangeLog(url, ctx);

  if (segs[0] === "card-status" && segs.length === 1 && method === "GET") return getCardStatus(ctx);

  if (segs[0] === "publish" && segs.length === 1 && method === "POST") return publish(request, ctx, principal);

  if (segs[0] === "parts") {
    if (segs.length === 1) {
      if (method === "GET") return listParts(url, ctx);
      if (method === "POST") return upsertDraft(request, ctx, principal);
    } else {
      const id = segs[1];
      if (!ID_RE.test(id)) throw new ApiError(400, "BAD_ID", "Malformed part id");
      if (segs.length === 2 && method === "GET") return getPart(ctx, id);
      if (segs.length === 3 && method === "POST") {
        switch (segs[2]) {
          case "price":
            return updatePrice(request, ctx, id, principal);
          case "verify":
            return verifyPart(request, ctx, id, principal);
          case "discard":
            return discardDraft(ctx, id, principal);
        }
      }
    }
  }
  throw new ApiError(404, "NOT_FOUND", `No admin route ${method} ${url.pathname}`);
}
