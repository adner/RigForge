import { describe, expect, it } from "vitest";
import { toResponse } from "./http";
import {
  DEVICE_COOKIE,
  DEVICE_TTL_SEC,
  SESSION_COOKIE,
  deviceCookieHeader,
  handleVerify,
  requireSession,
  sessionCookieHeader,
  signDevice,
  signSession,
  verifyDevice,
  verifySession,
} from "./session";

const KEY = "test-hmac-key-0123456789";
const NOW = new Date("2026-08-30T12:00:00.000Z");
const IAT = Math.floor(NOW.getTime() / 1000);
const bodyOf = async (res: Response) => (await res.json()) as Record<string, any>;

describe("session tokens", () => {
  it("signs and verifies a payload with iat/exp = +1h and a nonce", async () => {
    const token = await signSession(KEY, "device-test", NOW);
    const payload = await verifySession(token, KEY, NOW);
    expect(payload).toMatchObject({ kind: "session", uid: "device-test", iat: IAT, exp: IAT + 3600 });
    expect(payload!.nonce.length).toBeGreaterThan(8);
  });

  it("rejects expired, tampered, wrong-key and malformed tokens", async () => {
    const token = await signSession(KEY, NOW);
    expect(await verifySession(token, KEY, new Date(NOW.getTime() + 3600_000))).toBeNull();
    expect(await verifySession(token, KEY, new Date(NOW.getTime() + 3599_000))).not.toBeNull();
    expect(await verifySession(token, "other-key", NOW)).toBeNull();
    const [body, sig] = token.split(".");
    expect(await verifySession(`${body}x.${sig}`, KEY, NOW)).toBeNull();
    expect(await verifySession(`${body}.${sig.slice(0, -2)}AA`, KEY, NOW)).toBeNull();
    for (const bad of ["", "abc", ".", "a.b", "a.b.c"]) expect(await verifySession(bad, KEY, NOW)).toBeNull();
  });

  it("requireSession → 403 VERIFICATION_REQUIRED without / with a bad cookie, passes with a good one", async () => {
    await expect(requireSession(new Request("http://x/api/render"), KEY, NOW)).rejects.toMatchObject({ status: 403, code: "VERIFICATION_REQUIRED" });
    await expect(
      requireSession(new Request("http://x/api/render", { headers: { cookie: `${SESSION_COOKIE}=garbage.garbage` } }), KEY, NOW),
    ).rejects.toMatchObject({ status: 403, code: "VERIFICATION_REQUIRED" });
    const token = await signSession(KEY, NOW);
    const req = new Request("http://x/api/render", { headers: { cookie: `other=1; ${SESSION_COOKIE}=${token}; more=2` } });
    expect((await requireSession(req, KEY, NOW)).exp).toBe(IAT + 3600);
    await expect(requireSession(req, undefined, NOW)).rejects.toMatchObject({ status: 503, code: "RENDER_UNAVAILABLE" });
  });

  it("cookie attributes: HttpOnly, Secure, SameSite=Strict, Path=/api/", () => {
    const h = sessionCookieHeader("t");
    expect(h).toContain("HttpOnly");
    expect(h).toContain("Secure");
    expect(h).toContain("SameSite=Strict");
    expect(h).toContain("Path=/api/");
    expect(h).toContain("Max-Age=3600");
    const device = deviceCookieHeader("d");
    expect(device).toContain(`${DEVICE_COOKIE}=d`);
    expect(device).toContain(`Max-Age=${DEVICE_TTL_SEC}`);
    expect(device).toContain("HttpOnly");
  });

  it("signs a distinct 30-day device token that cannot be used as a session", async () => {
    const token = await signDevice(KEY, "device-test", NOW);
    expect(await verifyDevice(token, KEY, NOW)).toMatchObject({ kind: "device", uid: "device-test", exp: IAT + DEVICE_TTL_SEC });
    expect(await verifySession(token, KEY, NOW)).toBeNull();
    expect(await verifyDevice(token, KEY, new Date(NOW.getTime() + DEVICE_TTL_SEC * 1000))).toBeNull();
  });
});

describe("POST /api/verify", () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("http://x/api/verify", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

  it("calls siteverify and sets both device and session cookies on success", async () => {
    let posted: URLSearchParams | null = null;
    const fetchFn: typeof fetch = async (_url, init) => {
      posted = init?.body as URLSearchParams;
      return Response.json({ success: true });
    };
    const res = await handleVerify(post({ token: "tok" }, { "cf-connecting-ip": "1.2.3.4" }), { hmacKey: KEY, turnstileSecret: "s3cret", fetchFn, now: () => NOW });
    expect(res.status).toBe(200);
    expect(posted!.get("secret")).toBe("s3cret");
    expect(posted!.get("response")).toBe("tok");
    expect(posted!.get("remoteip")).toBe("1.2.3.4");
    const cookie = res.headers.get("set-cookie")!;
    const token = /rb_session=([^;]+)/.exec(cookie)![1];
    const deviceToken = /rb_device=([^;]+)/.exec(cookie)![1];
    const [session, device] = await Promise.all([verifySession(token, KEY, NOW), verifyDevice(deviceToken, KEY, NOW)]);
    expect(session).not.toBeNull();
    expect(device).not.toBeNull();
    expect(session!.uid).toBe(device!.uid);
  });

  it("reuses the signed device id when a later Turnstile verification refreshes the session", async () => {
    const first = await handleVerify(post({ token: "one" }), { hmacKey: KEY, skipTurnstile: true, now: () => NOW });
    const firstCookies = first.headers.get("set-cookie")!;
    const deviceToken = /rb_device=([^;]+)/.exec(firstCookies)![1];
    const device = await verifyDevice(deviceToken, KEY, NOW);
    const later = new Date(NOW.getTime() + 2 * 3600_000);
    const second = await handleVerify(post({ token: "two" }, { cookie: `${DEVICE_COOKIE}=${deviceToken}` }), { hmacKey: KEY, skipTurnstile: true, now: () => later });
    const secondSessionToken = /rb_session=([^;]+)/.exec(second.headers.get("set-cookie")!)![1];
    expect((await verifySession(secondSessionToken, KEY, later))!.uid).toBe(device!.uid);
  });

  it("rejects a failed challenge with 403 VERIFICATION_FAILED and a missing token with 400", async () => {
    const fetchFn: typeof fetch = async () => Response.json({ success: false });
    const res = await handleVerify(post({ token: "bad" }), { hmacKey: KEY, turnstileSecret: "s", fetchFn }).catch(toResponse);
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error.code).toBe("VERIFICATION_FAILED");
    const missing = await handleVerify(post({}), { hmacKey: KEY, turnstileSecret: "s", fetchFn }).catch(toResponse);
    expect(missing.status).toBe(400);
  });

  it("DEV_SKIP_TURNSTILE accepts any token without calling siteverify; missing HMAC key → 503", async () => {
    const fetchFn: typeof fetch = async () => {
      throw new Error("must not be called");
    };
    const res = await handleVerify(post({ token: "anything" }), { hmacKey: KEY, skipTurnstile: true, fetchFn });
    expect(res.status).toBe(200);
    const noKey = await handleVerify(post({ token: "x" }), { hmacKey: undefined, skipTurnstile: true }).catch(toResponse);
    expect(noKey.status).toBe(503);
  });
});
