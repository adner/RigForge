import { describe, expect, it, vi } from "vitest";
import { createAdminApi } from "./api";
import { AdminApiError } from "./envelope";

const respond = (status: number, body: unknown, json = true) =>
  new Response(json ? JSON.stringify(body) : String(body), { status, headers: { "content-type": json ? "application/json" : "text/html" } });

const client = (impl: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  const fetchFn = vi.fn(impl) as unknown as typeof fetch;
  return { api: createAdminApi(fetchFn), fetchFn: fetchFn as unknown as ReturnType<typeof vi.fn> };
};

const failure = async (p: Promise<unknown>): Promise<AdminApiError> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof AdminApiError) return e;
    throw e;
  }
  throw new Error("expected rejection");
};

describe("admin api client", () => {
  it("builds list query params and sends same-origin credentials", async () => {
    const { api, fetchFn } = client(() => respond(200, { ok: true, count: 0, parts: [] }));
    await api.listParts({ status: "draft", category: "gpu", q: "5060", limit: 10 });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/parts?status=draft&category=gpu&q=5060&limit=10");
    expect(init.credentials).toBe("same-origin");
  });

  it("reads card availability through one Access-cookie request", async () => {
    const payload = { ok: true, specificPartIds: ["gpu-x"], genericArchetypes: ["gpu-2fan-slim"] };
    const { api, fetchFn } = client(() => respond(200, payload));
    await expect(api.getCardAvailability()).resolves.toEqual(payload);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/card-status");
    expect(init.credentials).toBe("same-origin");
  });

  it("reads the current accountable Access identity", async () => {
    const payload = { ok: true, identity: "judge@example.com", accountable: true, role: "contributor" };
    const { api, fetchFn } = client(() => respond(200, payload));
    await expect(api.getSession()).resolves.toEqual(payload);
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe("/api/admin/session");
  });

  it("maps 503 ACCESS_NOT_CONFIGURED", async () => {
    const { api } = client(() => respond(503, { ok: false, error: { code: "ACCESS_NOT_CONFIGURED", message: "unset" } }));
    const err = await failure(api.listParts());
    expect(err.code).toBe("ACCESS_NOT_CONFIGURED");
    expect(err.status).toBe(503);
  });

  it("maps 401 (JSON) and opaque HTML 401/302/403 to UNAUTHORIZED", async () => {
    const a = await failure(client(() => respond(401, { ok: false, error: { code: "UNAUTHORIZED", message: "no jwt" } })).api.listParts());
    expect(a.code).toBe("UNAUTHORIZED");
    const b = await failure(client(() => respond(403, "<html>Access login</html>", false)).api.listParts());
    expect(b.code).toBe("UNAUTHORIZED");
    expect(b.message).toMatch(/Cloudflare Access/);
  });

  it("maps network failure to BACKEND_UNAVAILABLE", async () => {
    const { api } = client(() => {
      throw new TypeError("Failed to fetch");
    });
    const err = await failure(api.getSchema("gpu"));
    expect(err.code).toBe("BACKEND_UNAVAILABLE");
    expect(err.status).toBe(0);
  });

  it("passes through Worker validation codes and details", async () => {
    const { api } = client(() => respond(400, { ok: false, error: { code: "CONFIRM_REQUIRED", message: "Validation failed", details: [{ path: "confirm" }] } }));
    const err = await failure(api.publish(undefined, "agent"));
    expect(err.code).toBe("CONFIRM_REQUIRED");
    expect(err.details).toEqual([{ path: "confirm" }]);
  });

  it("verifyPart is the only call that sends the admin-UI header", async () => {
    const { api, fetchFn } = client(() => respond(200, { ok: true, partId: "x", verified: true, status: "draft", diff: [], catalogVersion: 1, published: 0, partIds: [], discarded: true }));
    await api.verifyPart("gpu-x");
    await api.upsertDraft({ category: "gpu" }, "human");
    await api.updatePrice("gpu-x", 1, undefined, "agent");
    await api.discardDraft("gpu-x");
    await api.publish(undefined, "human");
    const headerOf = (i: number) => ((fetchFn.mock.calls[i] as [string, RequestInit])[1].headers as Record<string, string>)["X-RigBuilder-Admin-UI"];
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe("/api/admin/parts/gpu-x/verify");
    expect(headerOf(0)).toBe("1");
    for (let i = 1; i < 5; i++) expect(headerOf(i)).toBeUndefined();
    const body = JSON.parse((fetchFn.mock.calls[4] as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ confirm: true, actor: "human" });
  });
});
