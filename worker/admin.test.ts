import { beforeEach, describe, expect, it } from "vitest";
import { resetAccessKeyCache } from "./access";
import { ADMIN_UI_HEADER, handleAdmin, maskIdentity, type AdminContext } from "./admin";
import { memoryCardStore } from "./card-store";
import { toResponse } from "./http";
import { cpuFixture, gpuDraftInput, gpuFixture, T0 } from "./fixtures";
import { memoryRepo, type MemoryRepo } from "./repo-memory";

const version = { version: 1, publishedAt: T0, snapshotDate: "2026-08-29", summary: "seed" };
const NOW = new Date("2026-08-30T12:00:00.000Z");

let repo: MemoryRepo;
let ctx: AdminContext;

const call = (path: string, init: RequestInit = {}, c: AdminContext = ctx) => {
  const url = new URL(`http://x${path}`);
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const request = new Request(url, { ...init, headers });
  // Handlers throw ApiError; mirror what index.ts does.
  return handleAdmin(request, url, c).catch(toResponse);
};
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(path, { method: "POST", body: JSON.stringify(body), headers });
const bodyOf = async (res: Response) => (await res.json()) as Record<string, any>;

beforeEach(() => {
  repo = memoryRepo([cpuFixture, gpuFixture], version);
  ctx = { repo, access: null, now: () => NOW };
});

describe("POST /api/admin/parts (upsert draft)", () => {
  it("creates a draft, forcing status/verified/addedBy/updatedAt", async () => {
    const res = await post("/api/admin/parts", { part: gpuDraftInput, addedBy: "agent", note: "launch day" });
    expect(res.status).toBe(200);
    const b = await bodyOf(res);
    expect(b).toMatchObject({ ok: true, partId: "gpu-test-5060-ti-16gb", status: "draft" });
    expect(b.diff[0].after).toBe("new part");

    const draft = await repo.getPart("gpu-test-5060-ti-16gb", "draft");
    expect(draft).toMatchObject({ status: "draft", verified: false, addedBy: "agent", updatedAt: NOW.toISOString(), priceUpdatedAt: NOW.toISOString() });
    expect(await repo.getPart("gpu-test-5060-ti-16gb", "published")).toBeNull();
    expect(repo.log.at(-1)).toMatchObject({ actor: "agent", action: "draft_create", detail: "launch day" });
  });

  it("cannot flip status to published or addedBy to seed via the body", async () => {
    await post("/api/admin/parts", { part: { ...gpuDraftInput, status: "published", addedBy: "seed" }, addedBy: "human" });
    const draft = await repo.getPart("gpu-test-5060-ti-16gb", "draft");
    expect(draft).toMatchObject({ status: "draft", addedBy: "human" });
    expect(repo.rows.size).toBe(3);
  });

  it("rejects verified:true with 400 VERIFIED_IS_HUMAN_ONLY", async () => {
    const res = await post("/api/admin/parts", { part: { ...gpuDraftInput, verified: true } });
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error.code).toBe("VERIFIED_IS_HUMAN_ONLY");
    expect(repo.rows.size).toBe(2);
  });

  it("rejects markup / URLs in name (schema) with a field-level detail", async () => {
    for (const name of ["<b>RTX</b> 5060", "see https://evil.example", "two\nlines"]) {
      const res = await post("/api/admin/parts", { part: { ...gpuDraftInput, name } });
      expect(res.status).toBe(400);
      const b = await bodyOf(res);
      expect(b.error.code).toBe("VALIDATION");
      expect(b.error.details.some((d: { path: string }) => d.path === "name")).toBe(true);
    }
  });

  it("rejects unknown categories, bad ids and http sources", async () => {
    expect((await post("/api/admin/parts", { part: { ...gpuDraftInput, category: "tpu" } })).status).toBe(400);
    expect((await post("/api/admin/parts", { part: { ...gpuDraftInput, id: "Bad Id!" } })).status).toBe(400);
    expect((await post("/api/admin/parts", { part: { ...gpuDraftInput, sources: [{ url: "http://x.example" }] } })).status).toBe(400);
  });

  it("generates an id when omitted and shows a diff when updating an existing part", async () => {
    const { id: _omit, ...noId } = gpuDraftInput;
    const created = await bodyOf(await post("/api/admin/parts", { part: noId }));
    expect(created.partId).toBe("gpu-testbrand-test-5060-ti-16gb");

    const update = await bodyOf(await post("/api/admin/parts", { part: { ...gpuDraftInput, id: gpuFixture.id, priceUSD: 299 } }));
    expect(update.diff).toEqual(expect.arrayContaining([expect.objectContaining({ field: "priceUSD", before: 329, after: 299 })]));
    expect(await repo.getPart(gpuFixture.id, "published")).toMatchObject({ priceUSD: 329 }); // untouched until publish
  });

  it("rejects oversized bodies with 413 and non-JSON with 400", async () => {
    const big = { part: { ...gpuDraftInput, pad: "x".repeat(17 * 1024) } };
    expect((await post("/api/admin/parts", big)).status).toBe(413);
    const res = await call("/api/admin/parts", { method: "POST", body: "{not json", headers: { "content-type": "application/json" } });
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error.code).toBe("BAD_JSON");
  });
});

describe("price / verify / discard", () => {
  it("price update creates a draft from the published row and records the source", async () => {
    const res = await post(`/api/admin/parts/${gpuFixture.id}/price`, { priceUSD: 299, sourceUrl: "https://shop.example/5060" });
    expect(res.status).toBe(200);
    const draft = await repo.getPart(gpuFixture.id, "draft");
    expect(draft).toMatchObject({ priceUSD: 299, priceUpdatedAt: NOW.toISOString(), sources: [{ url: "https://shop.example/5060" }] });
    expect((await repo.getPart(gpuFixture.id, "published"))!.priceUSD).toBe(329);
    expect((await post("/api/admin/parts/nope-1/price", { priceUSD: 1 })).status).toBe(404);
  });

  it("verify requires the admin-UI header (agents' tools never send it)", async () => {
    const denied = await post(`/api/admin/parts/${gpuFixture.id}/verify`, { verified: true });
    expect(denied.status).toBe(403);
    expect((await bodyOf(denied)).error.code).toBe("VERIFIED_IS_HUMAN_ONLY");

    const okRes = await post(`/api/admin/parts/${gpuFixture.id}/verify`, { verified: true }, { [ADMIN_UI_HEADER]: "1" });
    expect(okRes.status).toBe(200);
    expect(await repo.getPart(gpuFixture.id, "draft")).toMatchObject({ verified: true, status: "draft" });
    expect(repo.log.at(-1)).toMatchObject({ actor: "human", action: "verify" });
  });

  it("discard removes only the draft", async () => {
    await post("/api/admin/parts", { part: { ...gpuDraftInput, id: gpuFixture.id } });
    expect((await post(`/api/admin/parts/${gpuFixture.id}/discard`, {})).status).toBe(200);
    expect(await repo.getPart(gpuFixture.id, "draft")).toBeNull();
    expect(await repo.getPart(gpuFixture.id, "published")).not.toBeNull();
    expect((await post(`/api/admin/parts/${gpuFixture.id}/discard`, {})).status).toBe(404);
  });
});

describe("publish", () => {
  it("requires confirm:true", async () => {
    const res = await post("/api/admin/publish", { confirm: false });
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error.code).toBe("CONFIRM_REQUIRED");
  });

  it("promotes drafts, bumps the version and appends change_log", async () => {
    await post("/api/admin/parts", { part: gpuDraftInput });
    await post(`/api/admin/parts/${gpuFixture.id}/price`, { priceUSD: 299 });
    const res = await bodyOf(await post("/api/admin/publish", { confirm: true, actor: "human" }));
    expect(res).toMatchObject({ ok: true, catalogVersion: 2, published: 2 });
    expect(await repo.currentVersion()).toMatchObject({ version: 2, snapshotDate: "2026-08-30" });
    expect(await repo.listParts({ status: "draft" })).toHaveLength(0);
    expect((await repo.getPart(gpuFixture.id, "published"))!.priceUSD).toBe(299);
    expect(await repo.getPart(gpuDraftInput.id, "published")).toMatchObject({ addedBy: "agent", verified: false });
    expect(repo.log.filter((l) => l.action === "publish_part")).toHaveLength(2);
    expect(repo.log.at(-1)).toMatchObject({ action: "publish", actor: "human" });
  });

  it("publishes only the selected partIds", async () => {
    await post("/api/admin/parts", { part: gpuDraftInput });
    await post(`/api/admin/parts/${gpuFixture.id}/price`, { priceUSD: 299 });
    const res = await bodyOf(await post("/api/admin/publish", { confirm: true, partIds: [gpuDraftInput.id] }));
    expect(res.partIds).toEqual([gpuDraftInput.id]);
    expect(await repo.getPart(gpuFixture.id, "draft")).not.toBeNull();
  });
});

describe("reads", () => {
  it("returns compact card-index availability without exposing R2 keys", async () => {
    const cards = memoryCardStore();
    cards.add(gpuFixture.id);
    cards.addGeneric("cpu-desktop");
    const res = await call("/api/admin/card-status", {}, { ...ctx, cards });
    const b = await bodyOf(res);
    expect(b).toEqual({ ok: true, specificPartIds: [gpuFixture.id], genericArchetypes: ["cpu-desktop"] });
    expect(JSON.stringify(b)).not.toContain("cards/");
  });

  it("reports unavailable card storage and does not accept writes on the status route", async () => {
    expect((await call("/api/admin/card-status")).status).toBe(503);
    expect((await call("/api/admin/card-status", { method: "POST", body: "{}" }, { ...ctx, cards: memoryCardStore() })).status).toBe(404);
  });

  it("lists with status/category/q filters and returns summaries", async () => {
    await post("/api/admin/parts", { part: gpuDraftInput });
    const all = await bodyOf(await call("/api/admin/parts"));
    expect(all.count).toBe(3);
    expect(Object.keys(all.parts[0]).sort()).toEqual(["addedBy", "brand", "category", "id", "name", "priceUSD", "status", "updatedAt", "verified"]);
    expect((await bodyOf(await call("/api/admin/parts?status=draft"))).count).toBe(1);
    expect((await bodyOf(await call("/api/admin/parts?category=cpu"))).count).toBe(1);
    expect((await bodyOf(await call("/api/admin/parts?q=5060%20ti"))).count).toBe(1);
    expect((await call("/api/admin/parts?category=tpu")).status).toBe(400);
  });

  it("GET /parts/:id returns both rows and a diff", async () => {
    await post(`/api/admin/parts/${gpuFixture.id}/price`, { priceUSD: 299 });
    const b = await bodyOf(await call(`/api/admin/parts/${gpuFixture.id}`));
    expect(b.published.priceUSD).toBe(329);
    expect(b.draft.priceUSD).toBe(299);
    expect(b.diff.map((d: { field: string }) => d.field)).toContain("priceUSD");
  });

  it("GET /schema/:category returns JSON Schema with the category literal", async () => {
    const b = await bodyOf(await call("/api/admin/schema/cooler"));
    expect(b.schema.properties.category.const ?? b.schema.properties.category.enum?.[0]).toBe("cooler");
    expect(b.schema.properties.socketSupport).toBeDefined();
    expect(b.notes.units).toMatch(/mm/);
    expect((await call("/api/admin/schema/tpu")).status).toBe(404);
  });

  it("GET /log lists change_log newest first with limit and before cursor", async () => {
    await post("/api/admin/parts", { part: gpuDraftInput, note: "launch day" });
    await bodyOf(await post("/api/admin/publish", { confirm: true, actor: "human" }));
    // publish writes publish_part + publish at the same instant; a later human verify is strictly newer.
    const later: AdminContext = { ...ctx, now: () => new Date("2026-08-30T13:00:00.000Z") };
    await call(`/api/admin/parts/${gpuFixture.id}/verify`, { method: "POST", body: JSON.stringify({ verified: true }), headers: { [ADMIN_UI_HEADER]: "1" } }, later);

    const all = await bodyOf(await call("/api/admin/log"));
    expect(all.ok).toBe(true);
    expect(all.entries.map((e: { action: string }) => e.action)).toEqual(["verify", "publish", "publish_part", "draft_create"]);
    expect(all.entries[0]).toMatchObject({ actor: "human", partId: gpuFixture.id, at: "2026-08-30T13:00:00.000Z" });
    expect(all.entries[3]).toMatchObject({ actor: "agent", action: "draft_create", detail: "launch day" });
    expect(all.nextBefore).toBeNull();

    const page = await bodyOf(await call("/api/admin/log?limit=1"));
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].action).toBe("verify");
    expect(page.nextBefore).toBe("2026-08-30T13:00:00.000Z");

    const older = await bodyOf(await call(`/api/admin/log?before=${encodeURIComponent(page.nextBefore)}`));
    expect(older.entries.map((e: { action: string }) => e.action)).toEqual(["publish", "publish_part", "draft_create"]);

    expect((await call("/api/admin/log?limit=0")).status).toBe(400);
    expect((await call("/api/admin/log?limit=201")).status).toBe(400);
    expect((await call("/api/admin/log?before=yesterday")).status).toBe(400);
    expect((await call("/api/admin/log", { method: "POST", body: "{}" })).status).toBe(404);
  });

  it("unknown routes are 404 in the envelope", async () => {
    const res = await call("/api/admin/nope");
    expect(res.status).toBe(404);
    expect(await bodyOf(res)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});

describe("Cloudflare Access gate", () => {
  const cfg = { teamDomain: "rigbuilder", aud: "aud-123" };
  const b64url = (b: ArrayBuffer | string) =>
    Buffer.from(typeof b === "string" ? b : new Uint8Array(b)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  async function keypair() {
    const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1" };
    const fetchFn = (async () => Response.json({ keys: [jwk] })) as unknown as typeof fetch;
    const sign = async (claims: Record<string, unknown>) => {
      const h = b64url(JSON.stringify({ alg: "RS256", kid: "k1" }));
      const p = b64url(JSON.stringify(claims));
      const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
      return `${h}.${p}.${b64url(sig)}`;
    };
    return { fetchFn, sign };
  }

  beforeEach(() => resetAccessKeyCache());

  it("rejects missing / garbage / expired / wrong-aud tokens with 401 and accepts a valid one", async () => {
    const { fetchFn, sign } = await keypair();
    const gated: AdminContext = { repo, access: cfg, now: () => NOW, fetchFn };
    const exp = Math.floor(NOW.getTime() / 1000) + 3600;
    const good = { iss: "https://rigbuilder.cloudflareaccess.com", aud: [cfg.aud], exp, email: "x@example.com" };

    expect((await call("/api/admin/parts", {}, gated)).status).toBe(401);
    expect((await call("/api/admin/log", {}, gated)).status).toBe(401);
    expect((await call("/api/admin/parts", { headers: { "cf-access-jwt-assertion": "abc.def" } }, gated)).status).toBe(401);
    expect((await call("/api/admin/parts", { headers: { "cf-access-jwt-assertion": await sign({ ...good, exp: exp - 7200 }) } }, gated)).status).toBe(401);
    expect((await call("/api/admin/parts", { headers: { "cf-access-jwt-assertion": await sign({ ...good, aud: "other" }) } }, gated)).status).toBe(401);
    const tampered = (await sign(good)).replace(/\.[^.]+$/, ".AAAA");
    expect((await call("/api/admin/parts", { headers: { "cf-access-jwt-assertion": tampered } }, gated)).status).toBe(401);

    const okRes = await call("/api/admin/parts", { headers: { "cf-access-jwt-assertion": await sign(good) } }, gated);
    expect(okRes.status).toBe(200);
  });

  it("attributes mutations to the verified JWT email and masks it in admin log responses", async () => {
    const { fetchFn, sign } = await keypair();
    const gated: AdminContext = { repo, access: cfg, now: () => NOW, fetchFn };
    const claims = {
      iss: "https://rigbuilder.cloudflareaccess.com",
      aud: [cfg.aud],
      exp: Math.floor(NOW.getTime() / 1000) + 3600,
      email: "Judge.Person@Example.com",
    };
    const token = await sign(claims);
    const mutation = await call(
      "/api/admin/parts",
      {
        method: "POST",
        body: JSON.stringify({ part: gpuDraftInput, addedBy: "agent", identity: "spoofed@example.net" }),
        headers: { "content-type": "application/json", "cf-access-jwt-assertion": token },
      },
      gated,
    );
    expect(mutation.status).toBe(200);
    expect(repo.log.at(-1)?.identity).toBe("judge.person@example.com");

    const log = await bodyOf(await call("/api/admin/log", { headers: { "cf-access-jwt-assertion": token } }, gated));
    expect(log.entries[0].identity).toBe("j***@example.com");
    expect(JSON.stringify(log)).not.toContain("judge.person@example.com");
    expect(JSON.stringify(log)).not.toContain("spoofed@example.net");

    const session = await bodyOf(await call("/api/admin/session", { headers: { "cf-access-jwt-assertion": token } }, gated));
    expect(session).toMatchObject({ ok: true, identity: "judge.person@example.com", accountable: true, role: "contributor" });
  });

  it("masks accountable identities without exposing full addresses", () => {
    expect(maskIdentity("a@example.com")).toBe("a*@example.com");
    expect(maskIdentity("judge@example.com")).toBe("j***@example.com");
    expect(maskIdentity("access:subject-123456789")).toMatch(/^access:subject/);
  });

  it("gives configured owner emails full rights and treats matching case-insensitively", async () => {
    const { fetchFn, sign } = await keypair();
    const ownerCtx: AdminContext = { repo, access: cfg, ownerEmails: ["andreas.adner@apprexo.se"], now: () => NOW, fetchFn };
    const token = await sign({
      iss: "https://rigbuilder.cloudflareaccess.com",
      aud: [cfg.aud],
      exp: Math.floor(NOW.getTime() / 1000) + 3600,
      email: "Andreas.Adner@Apprexo.se",
    });
    const headers = { "content-type": "application/json", "cf-access-jwt-assertion": token };
    const update = await call("/api/admin/parts", { method: "POST", body: JSON.stringify({ part: { ...gpuDraftInput, id: gpuFixture.id } }), headers }, ownerCtx);
    expect(update.status).toBe(200);
    const session = await bodyOf(await call("/api/admin/session", { headers }, ownerCtx));
    expect(session.role).toBe("owner");
  });

  it("lets contributors create, edit, discard and publish only brand-new parts", async () => {
    const { fetchFn, sign } = await keypair();
    const contributorCtx: AdminContext = { repo, access: cfg, ownerEmails: ["andreas.adner@apprexo.se"], now: () => NOW, fetchFn };
    const token = await sign({
      iss: "https://rigbuilder.cloudflareaccess.com",
      aud: [cfg.aud],
      exp: Math.floor(NOW.getTime() / 1000) + 3600,
      email: "judge@example.com",
    });
    const headers = { "content-type": "application/json", "cf-access-jwt-assertion": token };
    const contributorCall = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body), headers }, contributorCtx);

    expect((await contributorCall("/api/admin/parts", { part: gpuDraftInput, addedBy: "agent" })).status).toBe(200);
    expect((await contributorCall(`/api/admin/parts/${gpuDraftInput.id}/price`, { priceUSD: 419, addedBy: "agent" })).status).toBe(200);
    const verify = await contributorCall(`/api/admin/parts/${gpuDraftInput.id}/verify`, { verified: true });
    expect(verify.status).toBe(403);
    expect((await bodyOf(verify)).error.code).toBe("FORBIDDEN");
    const publish = await bodyOf(await contributorCall("/api/admin/publish", { confirm: true, actor: "agent" }));
    expect(publish).toMatchObject({ ok: true, published: 1, partIds: [gpuDraftInput.id] });
    expect(await repo.getPart(gpuDraftInput.id, "published")).toMatchObject({ priceUSD: 419, verified: false });

    const second = { ...gpuDraftInput, id: "gpu-second-new-part", name: "Second New Part" };
    await contributorCall("/api/admin/parts", { part: second });
    expect((await contributorCall(`/api/admin/parts/${second.id}/discard`, {})).status).toBe(200);
  });

  it("blocks contributor changes, price edits, draft deletion and publication for existing parts", async () => {
    const { fetchFn, sign } = await keypair();
    const contributorCtx: AdminContext = { repo, access: cfg, ownerEmails: ["andreas.adner@apprexo.se"], now: () => NOW, fetchFn };
    const token = await sign({
      iss: "https://rigbuilder.cloudflareaccess.com",
      aud: [cfg.aud],
      exp: Math.floor(NOW.getTime() / 1000) + 3600,
      email: "judge@example.com",
    });
    const headers = { "content-type": "application/json", "cf-access-jwt-assertion": token };
    const contributorCall = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body), headers }, contributorCtx);

    expect((await contributorCall("/api/admin/parts", { part: { ...gpuDraftInput, id: gpuFixture.id } })).status).toBe(403);
    expect((await contributorCall(`/api/admin/parts/${gpuFixture.id}/price`, { priceUSD: 1 })).status).toBe(403);

    await post("/api/admin/parts", { part: { ...gpuDraftInput, id: gpuFixture.id } }); // owner/local creates an existing-part draft
    expect((await contributorCall(`/api/admin/parts/${gpuFixture.id}/discard`, {})).status).toBe(403);
    const publish = await contributorCall("/api/admin/publish", { confirm: true, actor: "agent", partIds: [gpuFixture.id] });
    expect(publish.status).toBe(403);
    expect((await repo.getPart(gpuFixture.id, "published"))!.priceUSD).toBe(329);
  });
});
