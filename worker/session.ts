/**
 * Turnstile verification → signed anonymous-device + session cookies (DESIGN.md §4.3, §8).
 *
 *   POST /api/verify  {token}  → siteverify → Set-Cookie rb_device + rb_session
 *
 * Two HMAC-signed HttpOnly cookies are issued after Turnstile:
 *   rb_device  — a random anonymous browser id, refreshed for 30 days
 *   rb_session — a one-hour Turnstile proof bound to that device id
 * Local dev: DEV_SKIP_TURNSTILE=1 accepts any token.
 */
import { ApiError, ok, readJsonBody } from "./http";

export const SESSION_COOKIE = "rb_session";
export const DEVICE_COOKIE = "rb_device";
export const SESSION_TTL_SEC = 60 * 60;
export const DEVICE_TTL_SEC = 30 * 24 * 60 * 60;
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface SessionPayload {
  kind: "session";
  iat: number;
  exp: number;
  nonce: string;
  uid: string;
}

export interface DevicePayload {
  kind: "device";
  iat: number;
  exp: number;
  uid: string;
}

export interface SessionConfig {
  hmacKey: string | undefined;
  turnstileSecret?: string;
  /** Local dev only: accept any token without calling siteverify. */
  skipTurnstile?: boolean;
  now?: () => Date;
  fetchFn?: typeof fetch;
}

const enc = new TextEncoder();

export const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const b64urlDecode = (s: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
};

const keyCache = new Map<string, Promise<CryptoKey>>();
const hmacKey = (secret: string): Promise<CryptoKey> => {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keyCache.set(secret, k);
  }
  return k;
};

const validUid = (uid: unknown): uid is string => typeof uid === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(uid);

const signPayload = async (secret: string, payload: SessionPayload | DevicePayload): Promise<string> => {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
};

const readSignedPayload = async (token: string | null | undefined, secret: string): Promise<Record<string, unknown> | null> => {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = b64urlDecode(token.slice(dot + 1));
  if (!sig) return null;
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, enc.encode(body));
  if (!valid) return null;
  const raw = b64urlDecode(body);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const freshUid = (): string => b64url(crypto.getRandomValues(new Uint8Array(18)));

/** Signs a fresh session. Passing a Date as the second argument preserves the old test helper shape. */
export async function signSession(secret: string, uidOrNow: string | Date = freshUid(), at: Date = new Date()): Promise<string> {
  const uid = uidOrNow instanceof Date ? freshUid() : uidOrNow;
  const now = uidOrNow instanceof Date ? uidOrNow : at;
  if (!validUid(uid)) throw new Error("invalid anonymous device id");
  const iat = Math.floor(now.getTime() / 1000);
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  return signPayload(secret, { kind: "session", iat, exp: iat + SESSION_TTL_SEC, nonce, uid });
}

export async function signDevice(secret: string, uid: string = freshUid(), now: Date = new Date()): Promise<string> {
  if (!validUid(uid)) throw new Error("invalid anonymous device id");
  const iat = Math.floor(now.getTime() / 1000);
  return signPayload(secret, { kind: "device", iat, exp: iat + DEVICE_TTL_SEC, uid });
}

/** Returns the payload if the token is well-formed, correctly signed and unexpired; else null. */
export async function verifySession(
  token: string | null | undefined,
  secret: string,
  now: Date = new Date(),
): Promise<SessionPayload | null> {
  const payload = await readSignedPayload(token, secret);
  if (!payload) return null;
  const nowSec = Math.floor(now.getTime() / 1000);
  if (payload.kind !== "session" || typeof payload.exp !== "number" || typeof payload.iat !== "number" || typeof payload.nonce !== "string" || !validUid(payload.uid)) return null;
  if (payload.exp <= nowSec || payload.iat > nowSec + 60) return null;
  return payload as unknown as SessionPayload;
}

export async function verifyDevice(token: string | null | undefined, secret: string, now: Date = new Date()): Promise<DevicePayload | null> {
  const payload = await readSignedPayload(token, secret);
  if (!payload) return null;
  const nowSec = Math.floor(now.getTime() / 1000);
  if (payload.kind !== "device" || typeof payload.exp !== "number" || typeof payload.iat !== "number" || !validUid(payload.uid)) return null;
  if (payload.exp <= nowSec || payload.iat > nowSec + 60) return null;
  return payload as unknown as DevicePayload;
}

export const readCookie = (request: Request, name: string): string | null => {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
};

export const sessionCookieHeader = (token: string): string =>
  `${SESSION_COOKIE}=${token}; Path=/api/; Max-Age=${SESSION_TTL_SEC}; HttpOnly; Secure; SameSite=Strict`;

export const deviceCookieHeader = (token: string): string =>
  `${DEVICE_COOKIE}=${token}; Path=/api/; Max-Age=${DEVICE_TTL_SEC}; HttpOnly; Secure; SameSite=Strict`;

/** Throws 403 VERIFICATION_REQUIRED unless the request carries a valid session cookie. */
export async function requireSession(request: Request, secret: string | undefined, now: Date = new Date()): Promise<SessionPayload> {
  if (!secret) throw new ApiError(503, "RENDER_UNAVAILABLE", "SESSION_HMAC_KEY is not configured");
  const session = await verifySession(readCookie(request, SESSION_COOKIE), secret, now);
  if (!session) throw new ApiError(403, "VERIFICATION_REQUIRED", "Ask the human to click Verify on the page, then retry");
  return session;
}

async function siteverify(token: string, secret: string, remoteIp: string | null, fetchFn: typeof fetch): Promise<boolean> {
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp) form.set("remoteip", remoteIp);
  let res: Response;
  try {
    res = await fetchFn(SITEVERIFY_URL, { method: "POST", body: form });
  } catch {
    throw new ApiError(503, "VERIFY_UNAVAILABLE", "Turnstile verification is temporarily unavailable");
  }
  if (!res.ok) throw new ApiError(503, "VERIFY_UNAVAILABLE", "Turnstile verification is temporarily unavailable");
  const body = (await res.json().catch(() => ({}))) as { success?: boolean };
  return body.success === true;
}

/** POST /api/verify */
export async function handleVerify(request: Request, cfg: SessionConfig): Promise<Response> {
  if (request.method !== "POST") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use POST");
  if (!cfg.hmacKey) throw new ApiError(503, "RENDER_UNAVAILABLE", "SESSION_HMAC_KEY is not configured");
  const body = (await readJsonBody(request, 4096)) as { token?: unknown } | null;
  const token = body && typeof body === "object" && typeof body.token === "string" ? body.token : "";
  if (!token || token.length > 2048) throw new ApiError(400, "INVALID_INPUT", "Missing Turnstile token");

  if (!cfg.skipTurnstile) {
    if (!cfg.turnstileSecret) throw new ApiError(503, "VERIFY_UNAVAILABLE", "TURNSTILE_SECRET is not configured");
    const passed = await siteverify(token, cfg.turnstileSecret, request.headers.get("cf-connecting-ip"), cfg.fetchFn ?? fetch);
    if (!passed) throw new ApiError(403, "VERIFICATION_FAILED", "Turnstile challenge failed; reload and try again");
  }
  const now = (cfg.now ?? (() => new Date()))();
  const existing = await verifyDevice(readCookie(request, DEVICE_COOKIE), cfg.hmacKey, now);
  const uid = existing?.uid ?? freshUid();
  const [device, session] = await Promise.all([signDevice(cfg.hmacKey, uid, now), signSession(cfg.hmacKey, uid, now)]);
  const headers = new Headers();
  headers.append("set-cookie", deviceCookieHeader(device));
  headers.append("set-cookie", sessionCookieHeader(session));
  return ok({ verified: true, expiresInSec: SESSION_TTL_SEC }, { headers });
}
