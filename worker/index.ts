/**
 * RigBuilder Worker — serves the static app and a thin /api surface.
 * The compatibility engine and all WebMCP tools run in the browser; this Worker
 * serves the catalog of record (D1), Access-gated admin writes, image rendering
 * (R2 + gpt-image-2 behind Turnstile/session + rate limits) and short share links (KV).
 * See DESIGN.md §3, §4.3, §9 and docs/BACKEND.md.
 */
import { handleAdmin } from "./admin";
import { handleBuildsGet, handleBuildsPost, kvStore } from "./builds";
import { burstLimiterFor } from "./burst";
import { r2CardStore } from "./card-store";
import { handleCardThumbnailGet } from "./cards";
import { handleCatalogGet } from "./catalog";
import { ApiError, ok, toResponse } from "./http";
import { openAiProvider } from "./image-provider";
import { logRequest } from "./log";
import { DEFAULT_USER_DAILY_CAP, RenderQuota, memoryQuota, parseCap, quotaClient, type QuotaClient } from "./quota";
import { handleRenderGet, handleRenderPost, handleRenderQuotaStatus } from "./render";
import { r2Store } from "./render-store";
import { d1Repo, type CatalogRepo } from "./repo";
import { handleVerify } from "./session";

export { RenderQuota };

export interface Env {
  IMAGE_PROVIDER: string;
  RENDER_DAILY_CAP: string;
  RENDER_USER_DAILY_CAP: string;
  IMAGE_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  /** HMAC key for the rb_session cookie (`wrangler secret put SESSION_HMAC_KEY`). */
  SESSION_HMAC_KEY?: string;
  /** Public Turnstile site key (var); the page reads it from /api/health. */
  TURNSTILE_SITE_KEY?: string;
  ASSETS: Fetcher;
  /** D1 catalog of record (binding added by the catalog workstream). */
  CATALOG?: D1Database;
  /** R2 bucket for content-addressed renders (`renders/<hash>.webp`) and part cards (`cards/`). */
  RENDERS?: R2Bucket;
  /** KV namespace for share-link payloads (90-day TTL). */
  BUILDS?: KVNamespace;
  /** Per-IP burst limiter (Rate-Limiting binding, 5 / 60 s). */
  RENDER_BURST?: RateLimit;
  /** Durable Object namespace holding the atomic daily render counter. */
  RENDER_QUOTA?: DurableObjectNamespace;
  /** Cloudflare Access team domain ("myteam" or "myteam.cloudflareaccess.com") and app AUD. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Comma-separated verified Access emails with full catalog mutation rights. */
  ADMIN_OWNER_EMAILS?: string;
  /** Local dev only (.dev.vars): "1" skips Access JWT validation on /api/admin/*. */
  DEV_ADMIN_BYPASS?: string;
  /** Local dev only: "1" re-validates the catalog with zod on every GET /api/catalog. */
  DEV_VALIDATE_CATALOG?: string;
  /** Local dev only: "1" makes POST /api/verify accept any token without calling Turnstile. */
  DEV_SKIP_TURNSTILE?: string;
}

const repoFor = (env: Env): CatalogRepo => {
  if (!env.CATALOG) throw new ApiError(503, "CATALOG_UNAVAILABLE", "D1 binding CATALOG is not configured");
  return d1Repo(env.CATALOG);
};

let localQuota: QuotaClient | null = null;
const quotaFor = (env: Env): QuotaClient => {
  if (env.RENDER_QUOTA) return quotaClient(env.RENDER_QUOTA);
  return (localQuota ??= memoryQuota(parseCap(env.RENDER_DAILY_CAP), parseCap(env.RENDER_USER_DAILY_CAP, DEFAULT_USER_DAILY_CAP)));
};

/** Reads and discards up to 64 KB of an unread request body, then cancels the rest. */
async function drain(body: ReadableStream<Uint8Array>): Promise<void> {
  const reader = body.getReader();
  let seen = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      seen += value.byteLength;
      if (seen > 64 * 1024) break;
    }
    await reader.cancel();
  } catch {
    /* ignore */
  }
}

const RENDER_RE = /^\/api\/render\/([0-9a-f]{64})\.webp$/;
const CARD_THUMB_RE = /^\/api\/cards\/([a-z0-9-]{1,80})\/thumb\.webp$/;
const BUILD_RE = /^\/api\/builds\/([a-z0-9]{1,32})$/;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/api/health") {
    let d1 = false;
    let catalogVersion: number | null = null;
    if (env.CATALOG) {
      const repo = d1Repo(env.CATALOG);
      d1 = await repo.ping();
      if (d1) catalogVersion = (await repo.currentVersion().catch(() => null))?.version ?? null;
    }
    return ok({
      service: "rigbuilder",
      version: "0.1.0",
      imageProvider: env.IMAGE_PROVIDER,
      imageKeyConfigured: Boolean(env.IMAGE_API_KEY),
      d1Reachable: d1,
      catalogVersion,
      render: {
        provider: env.IMAGE_PROVIDER,
        keyConfigured: Boolean(env.IMAGE_API_KEY),
        r2: Boolean(env.RENDERS),
        quota: Boolean(env.RENDER_QUOTA),
        burst: Boolean(env.RENDER_BURST),
        sessionConfigured: Boolean(env.SESSION_HMAC_KEY),
        turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
        turnstileSkipped: env.DEV_SKIP_TURNSTILE === "1",
        dailyCap: parseCap(env.RENDER_DAILY_CAP),
        userDailyCap: parseCap(env.RENDER_USER_DAILY_CAP, DEFAULT_USER_DAILY_CAP),
      },
      share: { kv: Boolean(env.BUILDS) },
      time: new Date().toISOString(),
    });
  }

  if (pathname === "/api/catalog") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET");
    }
    return handleCatalogGet(request, repoFor(env), { validate: env.DEV_VALIDATE_CATALOG === "1" });
  }

  if (pathname === "/api/verify") {
    return handleVerify(request, {
      hmacKey: env.SESSION_HMAC_KEY,
      turnstileSecret: env.TURNSTILE_SECRET,
      skipTurnstile: env.DEV_SKIP_TURNSTILE === "1",
    });
  }

  if (pathname === "/api/render") {
    return handleRenderPost(request, {
      repo: repoFor(env),
      store: env.RENDERS ? r2Store(env.RENDERS) : null,
      cards: env.RENDERS ? r2CardStore(env.RENDERS) : null,
      provider: env.IMAGE_API_KEY ? openAiProvider(env.IMAGE_API_KEY) : null,
      quota: quotaFor(env),
      burst: burstLimiterFor(env.RENDER_BURST),
      sessionKey: env.SESSION_HMAC_KEY,
    });
  }
  if (pathname === "/api/render/quota") {
    return handleRenderQuotaStatus(request, { quota: quotaFor(env), sessionKey: env.SESSION_HMAC_KEY });
  }
  const render = RENDER_RE.exec(pathname);
  if (render) {
    if (request.method !== "GET" && request.method !== "HEAD") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET");
    return handleRenderGet(render[1], env.RENDERS ? r2Store(env.RENDERS) : null);
  }

  const cardThumb = CARD_THUMB_RE.exec(pathname);
  if (cardThumb) {
    if (request.method !== "GET" && request.method !== "HEAD") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET");
    return handleCardThumbnailGet(request, cardThumb[1], url.searchParams.get("fallback"), env.RENDERS ? r2CardStore(env.RENDERS) : null);
  }

  if (pathname === "/api/builds") {
    if (request.method !== "POST") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use POST");
    return handleBuildsPost(request, {
      repo: repoFor(env),
      store: env.BUILDS ? kvStore(env.BUILDS) : null,
      burst: burstLimiterFor(env.RENDER_BURST),
    });
  }
  const build = BUILD_RE.exec(pathname);
  if (build) {
    if (request.method !== "GET") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET");
    return handleBuildsGet(build[1], { store: env.BUILDS ? kvStore(env.BUILDS) : null });
  }

  if (pathname.startsWith("/api/admin")) {
    const bypass = env.DEV_ADMIN_BYPASS === "1";
    if (!bypass && !(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD)) {
      throw new ApiError(503, "ACCESS_NOT_CONFIGURED", "ACCESS_TEAM_DOMAIN / ACCESS_AUD are not set");
    }
    return handleAdmin(request, url, {
      repo: repoFor(env),
      cards: env.RENDERS ? r2CardStore(env.RENDERS) : null,
      access: bypass ? null : { teamDomain: env.ACCESS_TEAM_DOMAIN!, aud: env.ACCESS_AUD! },
      ownerEmails: bypass ? [] : (env.ADMIN_OWNER_EMAILS ?? "").split(","),
    });
  }

  if (pathname.startsWith("/api/")) throw new ApiError(404, "NOT_FOUND", `No route ${pathname}`);

  // /b/<id> share links: served as the SPA; the app reads the id from the path.
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env): Promise<Response> {
    const started = Date.now();
    const url = new URL(request.url);
    let response: Response;
    try {
      response = await route(request, env);
    } catch (err) {
      if (!(err instanceof ApiError)) console.error("unhandled", err instanceof Error ? err.message : "error");
      response = toResponse(err);
    }
    // Early rejections (403/429/405…) leave the request body unread; an unconsumed body
    // breaks the keep-alive stream between wrangler's proxy and workerd in local dev.
    if (request.body && !request.bodyUsed) await drain(request.body);
    if (url.pathname.startsWith("/api/")) {
      // Logging policy (§8): no ids — collapse render hashes / build ids to route templates.
      const path = url.pathname.replace(RENDER_RE, "/api/render/:hash.webp").replace(CARD_THUMB_RE, "/api/cards/:partId/thumb.webp").replace(BUILD_RE, "/api/builds/:id");
      logRequest({ method: request.method, path, status: response.status, durationMs: Date.now() - started });
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
