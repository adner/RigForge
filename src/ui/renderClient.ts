/**
 * Human-side render path (DESIGN §4.3 render_build, §7.2): Turnstile → POST /api/verify (device + session cookies)
 * → POST /api/render, with the artifact lifecycle written through the shared store.
 * The agent tool sends exactly the same body; nothing derived leaves the client.
 */
import { allParts, type RenderAngle, type RenderStyle } from "../engine";
import { hashBuild, useStore, type RenderArtifact } from "../store";

export type RenderErrorCode =
  | "VERIFICATION_REQUIRED"
  | "RENDER_NEEDS_CASE"
  | "RENDER_RATE_LIMITED"
  | "RENDER_USER_DAILY_LIMIT"
  | "RENDER_GLOBAL_DAILY_LIMIT"
  | "RENDER_IN_PROGRESS"
  | "RENDER_FAILED"
  | "RENDER_UNAVAILABLE"
  | "BACKEND_UNAVAILABLE"
  | "INVALID_INPUT"
  | "UNKNOWN_PART"
  | "CANCELLED"
  | "INTERNAL";

export interface RenderQuotaDetails {
  userLimit?: number;
  userRemaining?: number;
  globalLimit?: number;
  globalRemaining?: number;
  retryAfterSec?: number;
  resetsAt?: string;
}

export interface RenderQuotaStatus {
  userLimit: number;
  userRemaining: number;
  globalLimit: number;
  globalRemaining: number;
  resetsAt: string;
}

export type RenderOutcome = { ok: true; render: RenderArtifact } | { ok: false; code: RenderErrorCode; message: string; retryAfterSec?: number; details?: RenderQuotaDetails };

interface ApiFail {
  ok: false;
  error: { code: string; message: string; details?: RenderQuotaDetails };
}
interface RenderOk {
  ok: true;
  renderId: string;
  buildHash: string;
  imageUrl: string;
  style: RenderStyle;
  angle: RenderAngle;
  cached: boolean;
}

// ---------- Turnstile (invisible widget) ----------

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: Record<string, unknown>): string;
      execute(id: string): void;
      remove(id: string): void;
    };
  }
}

const BUILD_SITE_KEY: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY;
let siteKeyPromise: Promise<string | null> | null = null;
let scriptPromise: Promise<void> | null = null;

async function turnstileSiteKey(): Promise<string | null> {
  if (BUILD_SITE_KEY) return BUILD_SITE_KEY;
  if (!siteKeyPromise) {
    siteKeyPromise = fetch("/api/health", { headers: { accept: "application/json" } })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { ok?: boolean; render?: { turnstileSiteKey?: unknown; turnstileSkipped?: boolean } } | null;
        const key = body?.render?.turnstileSiteKey;
        return res.ok && body?.ok && typeof key === "string" && key && !key.startsWith("<") ? key : null;
      })
      .catch(() => null);
  }
  return siteKeyPromise;
}

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Turnstile script failed to load"));
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

/** Resolves a Turnstile token; without a site key (local dev) returns a dummy the Worker accepts under DEV_SKIP_TURNSTILE=1. */
export async function getTurnstileToken(): Promise<string> {
  const siteKey = await turnstileSiteKey();
  if (!siteKey) return "dev-token";
  await loadTurnstile();
  const ts = window.turnstile!;
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.bottom = "0";
  host.style.right = "0";
  document.body.appendChild(host);
  return new Promise<string>((resolve, reject) => {
    const id = ts.render(host, {
      sitekey: siteKey,
      size: "invisible",
      execution: "execute",
      callback: (token: string) => {
        ts.remove(id);
        host.remove();
        resolve(token);
      },
      "error-callback": () => {
        ts.remove(id);
        host.remove();
        reject(new Error("Turnstile challenge failed"));
      },
    });
    ts.execute(id);
  });
}

// ---------- API ----------

export async function verifySession(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const token = await getTurnstileToken();
    const res = await fetch("/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      credentials: "same-origin",
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
    if (res.ok && body?.ok) return { ok: true };
    return { ok: false, message: body?.error?.message ?? `verify failed (${res.status})` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function getRenderQuotaStatus(): Promise<RenderQuotaStatus | null> {
  try {
    const res = await fetch("/api/render/quota", { credentials: "same-origin", headers: { accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as ({ ok?: boolean } & Partial<RenderQuotaStatus>) | null;
    if (!res.ok || !body?.ok || typeof body.userRemaining !== "number" || typeof body.globalRemaining !== "number") return null;
    return body as RenderQuotaStatus;
  } catch {
    return null;
  }
}

const localLimitMessage = (code: RenderErrorCode, fallback: string, details?: RenderQuotaDetails): string => {
  if (code !== "RENDER_USER_DAILY_LIMIT" || !details?.resetsAt) return fallback;
  const reset = new Date(details.resetsAt);
  const local = Number.isNaN(reset.getTime()) ? details.resetsAt : reset.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `You've used all ${details.userLimit ?? 10} renders for today. Your render allowance resets at ${local}.`;
};

export interface RenderRequest {
  style?: RenderStyle;
  angle?: RenderAngle;
  flair?: string;
  signal?: AbortSignal;
}

/**
 * Renders the current build. Adds a `pending` artifact to the store immediately, then flips it to
 * `active` (or `superseded` if the build moved on meanwhile) or removes it on failure.
 */
export async function renderCurrentBuild(opts: RenderRequest = {}): Promise<RenderOutcome> {
  const style = opts.style ?? "photoreal";
  const angle = opts.angle ?? "three-quarter";
  const flair = opts.flair;
  const s = useStore.getState();
  const partIds = allParts(s.build).map((p) => p.id);
  const forBuildRevision = s.buildRevision;
  if (!s.build.slots.case?.length) return { ok: false, code: "RENDER_NEEDS_CASE", message: "Add a case first — the render is derived from the case's attributes." };

  let localHash = "";
  try {
    localHash = await hashBuild(s.build, s.goal, style, angle, flair);
  } catch {
    /* no case; handled above */
  }
  const pendingId = `pending_${localHash || forBuildRevision}`;
  const pending: RenderArtifact = {
    renderId: pendingId,
    forBuildRevision,
    buildHash: localHash,
    imageUrl: "",
    status: "pending",
    style,
    angle,
    flair,
    createdAt: new Date().toISOString(),
  };
  s.addRender(pending);
  const drop = () => useStore.setState((st) => ({ renders: st.renders.filter((r) => r.renderId !== pendingId) }));

  try {
    const body: Record<string, unknown> = { v: 1, partIds, style, angle };
    if (s.goal) body.goal = s.goal;
    if (flair) body.flair = flair;
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      signal: opts.signal,
    });
    const json = (await res.json().catch(() => null)) as RenderOk | ApiFail | null;
    if (!json || !res.ok || !json.ok) {
      drop();
      const err = json && !json.ok ? json.error : undefined;
      const code = (err?.code as RenderErrorCode | undefined) ?? (res.status === 404 ? "RENDER_UNAVAILABLE" : "RENDER_FAILED");
      const details = err?.details;
      return {
        ok: false,
        code,
        message: localLimitMessage(code, err?.message ?? `render failed (${res.status})`, details),
        retryAfterSec: details?.retryAfterSec,
        details,
      };
    }
    // Still current? Compare the hash the worker computed with the build as it is *now*.
    const cur = useStore.getState();
    let stillCurrent = false;
    try {
      stillCurrent = (await hashBuild(cur.build, cur.goal, style, angle, flair)) === json.buildHash;
    } catch {
      stillCurrent = false;
    }
    const render: RenderArtifact = {
      renderId: json.renderId,
      forBuildRevision,
      buildHash: json.buildHash,
      imageUrl: json.imageUrl,
      status: stillCurrent ? "active" : "superseded",
      style,
      angle,
      flair,
      createdAt: new Date().toISOString(),
      cached: json.cached,
    };
    useStore.setState((st) => ({
      renders: [
        ...st.renders.filter((r) => r.renderId !== pendingId && r.renderId !== render.renderId).map((r) => (stillCurrent && r.status === "active" ? { ...r, status: "superseded" as const } : r)),
        render,
      ],
    }));
    return { ok: true, render };
  } catch (e) {
    drop();
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return { ok: false, code: aborted ? "CANCELLED" : "BACKEND_UNAVAILABLE", message: aborted ? "render cancelled" : "the render service could not be reached" };
  }
}
