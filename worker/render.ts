/**
 * Render routes (DESIGN.md §4.3 "render_build details (v2.1 trust boundary)").
 *
 *   POST /api/render            {v:1, partIds, goal?, style?, angle?, flair?}  (≤ 2 KB, session cookie)
 *   GET  /api/render/:hash.webp  content-addressed image from R2
 *
 * Order of checks on POST: session → burst limit → validate body → rebuild the canonical
 * prompt from catalog parts (the client never sends a prompt or hash) → pick the render mode
 * → sha256 → R2 hit (no provider call, no quota) → daily quota → provider (60 s) → R2 put.
 * The prompt and body are never logged; the prompt is returned to the caller only.
 *
 * Two modes (docs/RENDER_FIDELITY.md Phase 2):
 *   "composed" — the build's published part cards are read from R2 and sent to the image
 *                edits endpoint as reference images, so the render looks like the actual parts
 *                and stays consistent across angles. Chosen only when the case has an exact
 *                card and every other present card category has an exact or eligible reviewed
 *                generic card.
 *   "text"     — the deterministic text-only prompt (the original path, and the fallback).
 * A missing card never fails a render; it only downgrades the mode. Card bytes are read
 * server-side by id — the body schema stays strict and accepts no image or URL from the client.
 */
import { z } from "zod";
import type { Category } from "../src/data/schema";
import { partsIn } from "../src/engine/build";
import { GENERIC_CARD_DEFINITIONS, genericCardArchetype } from "../src/engine/cardArchetype";
import {
  RENDER_ANGLES,
  RENDER_FLAIR_MAX_LENGTH,
  RENDER_STYLES,
  RenderNeedsCaseError,
  buildHashInput,
  composePrompt,
  normalizeRenderFlair,
  renderPrompt,
} from "../src/engine/renderPrompt";
import type { Build } from "../src/engine/types";
import { clientKey, type BurstLimiter } from "./burst";
import { CARD_ORDER, type CardIndex, type CardIndexEntry, type CardStore, type GenericCardIndex } from "./card-store";
import { ApiError, ok, readJsonBody } from "./http";
import type { ImageProvider, ReferenceImage } from "./image-provider";
import { PAYLOAD_MAX_BYTES, goalSchema, parseOr400, partIdsSchema, partIndexFor, resolveParts, sha256Hex } from "./payload";
import type { QuotaClient } from "./quota";
import type { CatalogRepo } from "./repo";
import type { RenderMode, RenderStore } from "./render-store";
import { requireSession } from "./session";

export const RENDER_TIMEOUT_MS = 60 * 1000;

export interface RenderContext {
  repo: CatalogRepo;
  store: RenderStore | null;
  /** null → 503 RENDER_UNAVAILABLE (IMAGE_API_KEY missing). */
  provider: ImageProvider | null;
  /** Published part cards; null (or an empty index) → every render uses the text path. */
  cards?: CardStore | null;
  quota: QuotaClient;
  burst: BurstLimiter;
  sessionKey: string | undefined;
  now?: () => Date;
  timeoutMs?: number;
}

/** The cards a composed render would use, in provider order. Empty → text mode. */
async function planCards(build: Build, cards: CardStore | null | undefined): Promise<{ order: Category[]; keys: string[]; generic: Category[] }> {
  const empty = { order: [], keys: [], generic: [] };
  if (!cards) return empty;
  const [index, genericIndex] = await Promise.all([
    cards.index().catch((): CardIndex => ({})),
    cards.genericIndex().catch((): GenericCardIndex => ({})),
  ]);
  const order: Category[] = [];
  const keys: string[] = [];
  const generic: Category[] = [];
  for (const category of CARD_ORDER) {
    const part = partsIn(build, category)[0];
    if (!part) continue; // the category is not in the build — nothing to anchor
    let entry: CardIndexEntry | undefined = index[part.id];
    if (!entry) {
      // The case controls the whole silhouette and must always be part-specific. Internal
      // components may use a reviewed generic archetype when their exact card is absent.
      if (category === "case") return empty;
      const archetype = genericCardArchetype(part);
      if (!GENERIC_CARD_DEFINITIONS[archetype].composeEligible) return empty;
      entry = genericIndex[archetype];
      if (!entry) return empty;
      generic.push(category);
    }
    order.push(category);
    keys.push(entry.key);
  }
  // The case anchors the whole scene; without its card there is nothing to compose into.
  return order[0] === "case" ? { order, keys, generic } : empty;
}

const renderBody = z
  .object({
    v: z.literal(1),
    partIds: partIdsSchema,
    goal: goalSchema.optional(),
    style: z.enum(RENDER_STYLES).default("photoreal"),
    angle: z.enum(RENDER_ANGLES).default("three-quarter"),
    flair: z.string().trim().min(1).max(RENDER_FLAIR_MAX_LENGTH).regex(/^[^\u0000-\u001f\u007f]*$/, "flair must be a single line").optional(),
  })
  .strict();

export const imageUrlFor = (hash: string): string => `/api/render/${hash}.webp`;

export async function handleRenderPost(request: Request, ctx: RenderContext): Promise<Response> {
  if (request.method !== "POST") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use POST");
  const now = (ctx.now ?? (() => new Date()))();
  const session = await requireSession(request, ctx.sessionKey, now);
  if (!(await ctx.burst.allow(clientKey(request)))) {
    throw new ApiError(429, "RENDER_RATE_LIMITED", "Too many render requests; slow down", { retryAfterSec: 60 });
  }

  const body = parseOr400(renderBody, await readJsonBody(request, PAYLOAD_MAX_BYTES));
  const index = await partIndexFor(ctx.repo, now.getTime());
  const { slots } = resolveParts(body.partIds, index);
  const build: Build = { slots };
  const flair = normalizeRenderFlair(body.flair);

  let textPrompt: string;
  try {
    textPrompt = renderPrompt(build, body.goal, body.style, body.angle, flair);
  } catch (e) {
    if (e instanceof RenderNeedsCaseError) throw new ApiError(400, "RENDER_NEEDS_CASE", e.message);
    throw e;
  }
  // `buildHash` identifies the build + style + angle (the client can recompute it and does, to
  // tell an active render from a superseded one). The storage hash additionally folds in the
  // mode and the card keys, so it is the cache key and the id of the stored image.
  const buildHash = await sha256Hex(buildHashInput(build, body.goal, body.style, body.angle, flair));

  const cards = await planCards(build, ctx.cards);
  let mode: RenderMode = cards.keys.length ? "composed" : "text";
  let prompt = mode === "composed" ? composePrompt(build, body.goal, body.style, body.angle, cards.order, cards.generic, flair) : textPrompt;
  let hash = mode === "composed" ? await sha256Hex(buildHashInput(build, body.goal, body.style, body.angle, flair, cards.keys)) : buildHash;
  const answer = (extra: Record<string, unknown>) =>
    ok({ renderId: hash, buildHash, imageUrl: imageUrlFor(hash), style: body.style, angle: body.angle, mode, ...extra });

  if (!ctx.store) throw new ApiError(503, "RENDER_UNAVAILABLE", "Render storage is not configured");
  if (await ctx.store.exists(hash)) return answer({ cached: true });

  // Fetch the card bytes only on a miss. If any object behind an index entry is gone, fall back
  // to the text path (and its hash) rather than failing or storing a text render under a
  // composed key.
  let references: ReferenceImage[] = [];
  if (mode === "composed") {
    const fetched = await Promise.all(cards.keys.map((k) => ctx.cards!.get(k).catch(() => null)));
    if (fetched.every((f): f is ReferenceImage => f !== null)) {
      references = fetched;
    } else {
      mode = "text";
      prompt = textPrompt;
      hash = buildHash;
      references = [];
      if (await ctx.store.exists(hash)) return answer({ cached: true });
    }
  }

  if (!ctx.provider) throw new ApiError(503, "RENDER_UNAVAILABLE", "Image rendering is not configured");
  const quota = await ctx.quota.consume(session.uid, hash);
  if (!quota.allowed) {
    const details = {
      userLimit: quota.userLimit,
      userRemaining: quota.userRemaining,
      globalLimit: quota.globalLimit,
      globalRemaining: quota.globalRemaining,
      retryAfterSec: quota.retryAfterSec,
      resetsAt: quota.resetsAt,
    };
    if (quota.reason === "user") {
      throw new ApiError(429, "RENDER_USER_DAILY_LIMIT", `You've used all ${quota.userLimit} renders for today. Your allowance resets at ${quota.resetsAt} (UTC).`, details);
    }
    if (quota.reason === "global") {
      throw new ApiError(429, "RENDER_GLOBAL_DAILY_LIMIT", "RigBuilder's global render allowance has been reached for today. It resets at midnight UTC.", details);
    }
    throw new ApiError(409, "RENDER_IN_PROGRESS", "This exact build is already being rendered. Retry shortly; no render allowance was used by this request.", details);
  }

  let image;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ctx.timeoutMs ?? RENDER_TIMEOUT_MS);
    request.signal?.addEventListener("abort", () => ac.abort(), { once: true });
    try {
      image =
        mode === "composed"
          ? await ctx.provider.compose(prompt, references, { signal: ac.signal, aspect: "landscape" })
          : await ctx.provider.generate(prompt, { signal: ac.signal, aspect: "landscape" });
    } finally {
      clearTimeout(timer);
    }
    // The stored metadata records the *storage* hash, so it always matches the object's own key
    // (that is what GET /api/render/:hash.webp echoes back as x-rigbuilder-build-hash).
    await ctx.store.put(hash, image.bytes, image.contentType, { buildHash: hash, createdAt: now.toISOString(), style: body.style, angle: body.angle, mode });
  } finally {
    await ctx.quota.release(hash).catch(() => {});
  }
  return answer({
    cached: false,
    promptUsed: prompt,
    quota: {
      userLimit: quota.userLimit,
      userRemaining: quota.userRemaining,
      globalLimit: quota.globalLimit,
      globalRemaining: quota.globalRemaining,
      resetsAt: quota.resetsAt,
    },
  });
}

export async function handleRenderQuotaStatus(request: Request, ctx: Pick<RenderContext, "quota" | "sessionKey" | "now">): Promise<Response> {
  if (request.method !== "GET") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET");
  const now = (ctx.now ?? (() => new Date()))();
  const session = await requireSession(request, ctx.sessionKey, now);
  const quota = await ctx.quota.status(session.uid);
  return ok({
    userLimit: quota.userLimit,
    userRemaining: quota.userRemaining,
    globalLimit: quota.globalLimit,
    globalRemaining: quota.globalRemaining,
    resetsAt: quota.resetsAt,
  });
}

const HASH_RE = /^[0-9a-f]{64}$/;

export async function handleRenderGet(hash: string, store: RenderStore | null): Promise<Response> {
  if (!HASH_RE.test(hash)) throw new ApiError(404, "NOT_FOUND", "No such render");
  if (!store) throw new ApiError(503, "RENDER_UNAVAILABLE", "Render storage is not configured");
  const obj = await store.get(hash);
  if (!obj) throw new ApiError(404, "NOT_FOUND", "No such render");
  return new Response(obj.body as BodyInit, {
    status: 200,
    headers: {
      "content-type": obj.contentType,
      "content-length": String(obj.size),
      "cache-control": "public, max-age=31536000, immutable",
      etag: `"${hash}"`,
      "x-content-type-options": "nosniff",
      "x-rigbuilder-build-hash": obj.meta.buildHash,
    },
  });
}
