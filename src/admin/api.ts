/**
 * Typed client for /api/admin/* (docs/BACKEND.md). Same-origin, cookie-carrying
 * (Cloudflare Access sets its cookie on the same host). Every non-2xx response is
 * mapped to an AdminApiError with the Worker's {code, message}.
 *
 * `verifyPart` is the ONE human-only call: it sends `X-RigBuilder-Admin-UI: 1`. It is
 * exported for the UI; the WebMCP admin tools never import it.
 */
import type { Category, Part } from "../data/schema";
import type { GenericCardArchetype } from "../engine/cardArchetype";
import { AdminApiError } from "./envelope";

export type Writer = "agent" | "human";
export type StatusFilter = "published" | "draft" | "all";

export interface PartSummary {
  id: string;
  name: string;
  brand: string;
  category: Category;
  priceUSD: number;
  verified: boolean;
  status: "published" | "draft";
  addedBy: "seed" | Writer;
  updatedAt: string;
}
export interface FieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}
export interface UpsertResult {
  partId: string;
  status: "draft";
  validation: { ok: boolean; issues: unknown[] };
  diff: FieldDiff[];
}
export interface PriceResult {
  partId: string;
  status: "draft";
  diff: FieldDiff[];
}
export interface PublishResult {
  catalogVersion: number;
  published: number;
  partIds: string[];
}
export interface PartDetail {
  partId: string;
  published: Part | null;
  draft: Part | null;
  diff: FieldDiff[];
}
export interface ChangeLogEntry {
  at: string;
  actor: "seed" | "human" | "agent" | "system";
  /** Server-masked accountable Access identity; full email never leaves the admin backend. */
  identity?: string | null;
  action: string;
  partId?: string | null;
  detail?: string | null;
}
export interface ChangeLogPage {
  entries: ChangeLogEntry[];
  /** Cursor for the next (older) page; null when there is no more. */
  nextBefore: string | null;
}
export interface SchemaResult {
  category: Category;
  schema: Record<string, unknown>;
  notes: Record<string, string>;
}
export interface CardAvailability {
  specificPartIds: string[];
  genericArchetypes: GenericCardArchetype[];
}

const BASE = "/api/admin";

/** Translate transport/HTTP failures into stable codes the UI and tools switch on. */
async function request<T>(path: string, init: RequestInit = {}, fetchFn: typeof fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(`${BASE}${path}`, {
      ...init,
      credentials: "same-origin",
      headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
  } catch (e) {
    throw new AdminApiError("BACKEND_UNAVAILABLE", `Network error: ${e instanceof Error ? e.message : String(e)}`, 0);
  }
  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const b = body as { ok?: boolean; error?: { code?: string; message?: string; details?: unknown } } | null;
  if (res.ok && b?.ok === true) return body as T;

  // Access redirects to its login page (HTML, opaque) → treat any non-JSON 4xx/3xx as sign-in needed.
  const code = b?.error?.code ?? (res.status === 401 || res.status === 302 || res.status === 403 ? "UNAUTHORIZED" : res.status === 503 ? "ACCESS_NOT_CONFIGURED" : res.status >= 500 ? "BACKEND_UNAVAILABLE" : "INTERNAL");
  const message =
    b?.error?.message ??
    (code === "UNAUTHORIZED"
      ? "Not signed in — sign in via Cloudflare Access to use the catalog admin"
      : code === "ACCESS_NOT_CONFIGURED"
        ? "Admin API is not configured (ACCESS_TEAM_DOMAIN / ACCESS_AUD unset)"
        : `HTTP ${res.status}`);
  throw new AdminApiError(code, message, res.status, b?.error?.details);
}

const qs = (params: Record<string, string | number | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};

export interface AdminApi {
  /** The current viewer's own verified identity; never masked because it is returned only to that session. */
  getSession(): Promise<{ identity: string; accountable: boolean; role: "owner" | "contributor" }>;
  listParts(opts?: { status?: StatusFilter; category?: Category; q?: string; limit?: number }): Promise<{ count: number; parts: PartSummary[] }>;
  listPartsFull(opts?: { status?: StatusFilter; category?: Category; q?: string; limit?: number }): Promise<{ count: number; parts: Part[] }>;
  getPart(id: string): Promise<PartDetail>;
  getSchema(category: Category): Promise<SchemaResult>;
  /** Server change_log, newest first (default 50, max 200). */
  listChangeLog(opts?: { limit?: number; before?: string }): Promise<ChangeLogPage>;
  /** Reviewed image-index membership only; content-addressed R2 keys stay server-side. */
  getCardAvailability(): Promise<CardAvailability>;
  upsertDraft(part: Record<string, unknown>, addedBy: Writer, note?: string): Promise<UpsertResult>;
  updatePrice(id: string, priceUSD: number, sourceUrl: string | undefined, addedBy: Writer): Promise<PriceResult>;
  /** HUMAN ONLY — sends the admin-UI header. Never called by a WebMCP tool. */
  verifyPart(id: string, verified?: boolean): Promise<{ partId: string; verified: boolean }>;
  discardDraft(id: string): Promise<{ partId: string; discarded: true }>;
  publish(partIds: string[] | undefined, actor: Writer): Promise<PublishResult>;
}

export const createAdminApi = (fetchFn: typeof fetch = (...a) => fetch(...a)): AdminApi => ({
  getSession: () => request(`/session`, {}, fetchFn),
  listParts: (o = {}) => request(`/parts${qs({ status: o.status ?? "all", category: o.category, q: o.q, limit: o.limit })}`, {}, fetchFn),
  listPartsFull: (o = {}) => request(`/parts${qs({ status: o.status ?? "all", category: o.category, q: o.q, limit: o.limit, full: "1" })}`, {}, fetchFn),
  getPart: (id) => request(`/parts/${encodeURIComponent(id)}`, {}, fetchFn),
  getSchema: (category) => request(`/schema/${category}`, {}, fetchFn),
  listChangeLog: (o = {}) => request(`/log${qs({ limit: o.limit, before: o.before })}`, {}, fetchFn),
  getCardAvailability: () => request(`/card-status`, {}, fetchFn),
  upsertDraft: (part, addedBy, note) => request(`/parts`, { method: "POST", body: JSON.stringify({ part, addedBy, note }) }, fetchFn),
  updatePrice: (id, priceUSD, sourceUrl, addedBy) =>
    request(`/parts/${encodeURIComponent(id)}/price`, { method: "POST", body: JSON.stringify({ priceUSD, sourceUrl, addedBy }) }, fetchFn),
  verifyPart: (id, verified = true) =>
    request(`/parts/${encodeURIComponent(id)}/verify`, { method: "POST", body: JSON.stringify({ verified }), headers: { "X-RigBuilder-Admin-UI": "1" } }, fetchFn),
  discardDraft: (id) => request(`/parts/${encodeURIComponent(id)}/discard`, { method: "POST", body: "{}" }, fetchFn),
  publish: (partIds, actor) => request(`/publish`, { method: "POST", body: JSON.stringify({ confirm: true, partIds, actor }) }, fetchFn),
});

/** Default singleton used by the UI and the tools. */
export const adminApi: AdminApi = createAdminApi();
