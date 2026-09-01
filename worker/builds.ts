/**
 * Share links (DESIGN.md §4.3 export_build, §7.2): content-addressed short ids in KV.
 *
 *   POST /api/builds      {v:1, parts: string[], goal?}  (≤ 2 KB) → {id, url, payload}
 *   GET  /api/builds/:id                                     → {id, payload} | 404
 *
 * id = base32(sha256(canonical JSON))[:10]; the same payload always yields the same id
 * (idempotent put). The returned URL also carries the payload in the fragment so the link
 * works before KV propagates or if the backend is down (`/b/<id>#b=<base64url payload>`).
 */
import { z } from "zod";
import { clientKey, type BurstLimiter } from "./burst";
import { ApiError, ok, readJsonBody } from "./http";
import { PAYLOAD_MAX_BYTES, goalSchema, parseOr400, partIdsSchema, partIndexFor, resolveParts, type GoalInput } from "./payload";
import type { CatalogRepo } from "./repo";
import { b64url } from "./session";

export const BUILD_TTL_SEC = 90 * 24 * 60 * 60;
export const BUILD_ID_LEN = 10;

export interface BuildPayload {
  v: 1;
  parts: string[];
  goal?: GoalInput;
}

export interface BuildStore {
  get(id: string): Promise<BuildPayload | null>;
  put(id: string, payload: BuildPayload): Promise<void>;
}

export interface BuildsContext {
  repo: CatalogRepo;
  store: BuildStore | null;
  burst: BurstLimiter;
  now?: () => Date;
}

const buildBody = z.object({ v: z.literal(1), parts: partIdsSchema, goal: goalSchema.optional() }).strict();

/** Stable JSON: sorted keys, sorted + deduplicated part ids. */
export const canonicalPayload = (p: BuildPayload): BuildPayload => {
  const parts = [...new Set(p.parts)].sort();
  const out: BuildPayload = { v: 1, parts };
  if (p.goal) {
    const goal: GoalInput = { useCase: p.goal.useCase, budgetUSD: p.goal.budgetUSD };
    if (p.goal.preferences) {
      const prefs = Object.fromEntries(
        Object.entries(p.goal.preferences)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : 1)),
      ) as GoalInput["preferences"];
      if (prefs && Object.keys(prefs).length) goal.preferences = prefs;
    }
    out.goal = goal;
  }
  return out;
};

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export const base32 = (bytes: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};

export async function buildId(payload: BuildPayload): Promise<string> {
  const json = JSON.stringify(canonicalPayload(payload));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json)));
  return base32(digest).slice(0, BUILD_ID_LEN);
}

export const shareUrl = (id: string, payload: BuildPayload): string =>
  `/b/${id}#b=${b64url(new TextEncoder().encode(JSON.stringify(payload)))}`;

const ID_RE = /^[a-z2-7]{10}$/;

export async function handleBuildsPost(request: Request, ctx: BuildsContext): Promise<Response> {
  if (!(await ctx.burst.allow(clientKey(request)))) {
    throw new ApiError(429, "RATE_LIMITED", "Too many requests; slow down", { retryAfterSec: 60 });
  }
  const body = parseOr400(buildBody, await readJsonBody(request, PAYLOAD_MAX_BYTES));
  const now = (ctx.now ?? (() => new Date()))();
  const index = await partIndexFor(ctx.repo, now.getTime());
  resolveParts(body.parts, index); // throws UNKNOWN_PART / INVALID_INPUT
  const payload = canonicalPayload(body);
  const id = await buildId(payload);
  let transport: "short+fragment" | "fragment" = "fragment";
  if (ctx.store) {
    await ctx.store.put(id, payload);
    transport = "short+fragment";
  }
  return ok({ id, url: shareUrl(id, payload), payload, transport, ttlSec: BUILD_TTL_SEC });
}

export async function handleBuildsGet(id: string, ctx: Pick<BuildsContext, "store">): Promise<Response> {
  if (!ID_RE.test(id)) throw new ApiError(404, "NOT_FOUND", "No such build");
  if (!ctx.store) throw new ApiError(503, "BACKEND_UNAVAILABLE", "Build storage is not configured");
  const payload = await ctx.store.get(id);
  if (!payload) throw new ApiError(404, "NOT_FOUND", "No such build");
  return ok({ id, payload }, { headers: { "cache-control": "public, max-age=300" } });
}

// ---------- stores ----------

export const kvStore = (kv: KVNamespace): BuildStore => ({
  async get(id) {
    return (await kv.get<BuildPayload>(`b:${id}`, "json")) ?? null;
  },
  async put(id, payload) {
    await kv.put(`b:${id}`, JSON.stringify(payload), { expirationTtl: BUILD_TTL_SEC });
  },
});

export const memoryBuildStore = (): BuildStore & { map: Map<string, BuildPayload> } => {
  const map = new Map<string, BuildPayload>();
  return {
    map,
    async get(id) {
      return map.get(id) ?? null;
    },
    async put(id, payload) {
      map.set(id, payload);
    },
  };
};
