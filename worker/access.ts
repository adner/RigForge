/**
 * Cloudflare Access JWT validation for /api/admin/* (DESIGN.md §9).
 * Access injects `Cf-Access-Jwt-Assertion` (RS256). We verify it against the team's
 * public keys with WebCrypto — no library. Access at the edge is not trusted blindly.
 */
import { ApiError } from "./http";

export interface AccessConfig {
  teamDomain: string; // "myteam" or "myteam.cloudflareaccess.com"
  aud: string; // Access application AUD tag
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

const keyCache = new Map<string, { fetchedAt: number; keys: Jwk[] }>();
const KEY_TTL_MS = 10 * 60 * 1000;

export const accessIssuer = (teamDomain: string): string => {
  const host = teamDomain.includes(".") ? teamDomain : `${teamDomain}.cloudflareaccess.com`;
  return `https://${host}`;
};

const b64urlToBytes = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const decodeJson = (segment: string): Record<string, unknown> => {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(segment))) as Record<string, unknown>;
  } catch {
    throw new ApiError(401, "UNAUTHORIZED", "Malformed Access token");
  }
};

async function fetchKeys(issuer: string, fetchFn: typeof fetch): Promise<Jwk[]> {
  const cached = keyCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < KEY_TTL_MS) return cached.keys;
  const res = await fetchFn(`${issuer}/cdn-cgi/access/certs`);
  if (!res.ok) throw new ApiError(503, "ACCESS_CERTS_UNAVAILABLE", "Could not fetch Access signing keys");
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  keyCache.set(issuer, { fetchedAt: Date.now(), keys });
  return keys;
}

/** Test hook: drop cached signing keys. */
export const resetAccessKeyCache = (): void => keyCache.clear();

/**
 * Verifies the token and returns its claims. Throws ApiError(401) on any failure.
 * `fetchFn` is injectable for tests.
 */
export async function verifyAccessJwt(
  token: string | null,
  cfg: AccessConfig,
  fetchFn: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<Record<string, unknown>> {
  if (!token) throw new ApiError(401, "UNAUTHORIZED", "Missing Cf-Access-Jwt-Assertion header");
  const parts = token.split(".");
  if (parts.length !== 3) throw new ApiError(401, "UNAUTHORIZED", "Malformed Access token");
  const [h, p, s] = parts;
  const header = decodeJson(h);
  const claims = decodeJson(p);
  if (header.alg !== "RS256") throw new ApiError(401, "UNAUTHORIZED", "Unsupported token algorithm");

  const issuer = accessIssuer(cfg.teamDomain);
  const keys = await fetchKeys(issuer, fetchFn);
  const jwk = keys.find((k) => k.kid === header.kid) ?? (keys.length === 1 ? keys[0] : undefined);
  if (!jwk) throw new ApiError(401, "UNAUTHORIZED", "Unknown signing key");

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valid) throw new ApiError(401, "UNAUTHORIZED", "Invalid token signature");

  const nowSec = Math.floor(now / 1000);
  if (typeof claims.exp !== "number" || claims.exp < nowSec) throw new ApiError(401, "UNAUTHORIZED", "Token expired");
  if (typeof claims.nbf === "number" && claims.nbf > nowSec + 60) throw new ApiError(401, "UNAUTHORIZED", "Token not yet valid");
  if (claims.iss !== issuer) throw new ApiError(401, "UNAUTHORIZED", "Wrong token issuer");
  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.includes(cfg.aud) : aud === cfg.aud;
  if (!audOk) throw new ApiError(401, "UNAUTHORIZED", "Wrong token audience");
  return claims;
}
