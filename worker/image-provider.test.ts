import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./http";
import { OPENAI_IMAGE_MODEL, WEBP_MAGIC, openAiProvider, sniffContentType } from "./image-provider";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const imageOk = (bytes = WEBP_MAGIC) => new Response(JSON.stringify({ data: [{ b64_json: b64(bytes) }] }), { status: 200, headers: { "content-type": "application/json" } });
const refs = [
  { bytes: PNG, contentType: "image/png" },
  { bytes: PNG, contentType: "image/png" },
];

const capture = () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return imageOk();
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
};

describe("openAiProvider.compose", () => {
  it("posts multipart image[] entries to the edits endpoint, in the order given", async () => {
    const { calls, fetchFn } = capture();
    const out = await openAiProvider("k", fetchFn).compose("assemble it", refs, { aspect: "landscape" });
    expect(out.contentType).toBe("image/webp");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/images/edits");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer k");
    // fetch must set content-type itself so the multipart boundary matches the body.
    expect((calls[0].init.headers as Record<string, string>)["content-type"]).toBeUndefined();

    const fd = calls[0].init.body as FormData;
    expect(fd.get("model")).toBe(OPENAI_IMAGE_MODEL);
    expect(fd.get("prompt")).toBe("assemble it");
    expect(fd.get("size")).toBe("1536x1024");
    expect(fd.get("quality")).toBe("medium");
    expect(fd.get("output_format")).toBe("webp");
    expect(fd.get("output_compression")).toBe("60");
    const images = fd.getAll("image[]") as unknown as File[];
    expect(images).toHaveLength(2);
    expect(images.map((f) => f.name)).toEqual(["card-1.png", "card-2.png"]);
    expect(images.map((f) => f.type)).toEqual(["image/png", "image/png"]);
    expect(new Uint8Array(await images[0].arrayBuffer())).toEqual(PNG);
  });

  it("square aspect and the minimal retry when the model rejects an optional knob", async () => {
    const bodies: FormData[] = [];
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(init!.body as FormData);
      return bodies.length === 1
        ? new Response(JSON.stringify({ error: { param: "output_compression", message: "nope" } }), { status: 400, headers: { "content-type": "application/json" } })
        : imageOk();
    }) as unknown as typeof fetch;
    await openAiProvider("k", fetchFn).compose("p", refs, { aspect: "square" });
    expect(bodies).toHaveLength(2);
    expect(bodies[0].get("size")).toBe("1024x1024");
    expect(bodies[1].get("output_compression")).toBeNull();
    expect(bodies[1].getAll("image[]")).toHaveLength(2);
  });

  it("maps provider failures the same way generate() does and never leaks the body", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = (code: number) => openAiProvider("k", (async () => new Response("boom: assemble it", { status: code })) as unknown as typeof fetch);

    await expect(status(429).compose("assemble it", refs)).rejects.toMatchObject({ status: 429, code: "RENDER_RATE_LIMITED" });
    await expect(status(500).compose("assemble it", refs)).rejects.toMatchObject({ status: 502, code: "RENDER_FAILED" });
    expect(err.mock.calls.flat().join(" ")).not.toContain("assemble it");

    const abort = openAiProvider("k", (async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch);
    await expect(abort.compose("p", refs)).rejects.toMatchObject({ status: 504, code: "RENDER_FAILED" });

    const dead = openAiProvider("k", (async () => {
      throw new Error("socket");
    }) as unknown as typeof fetch);
    await expect(dead.compose("p", refs)).rejects.toMatchObject({ status: 502, code: "RENDER_FAILED" });
    err.mockRestore();
  });

  it("refuses to compose without reference images", () => {
    expect(() => openAiProvider("k", capture().fetchFn).compose("p", [])).toThrow(ApiError);
  });

  it("generate() still posts JSON to the generations endpoint", async () => {
    const { calls, fetchFn } = capture();
    await openAiProvider("k", fetchFn).generate("a pc");
    expect(calls[0].url).toBe("https://api.openai.com/v1/images/generations");
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ model: OPENAI_IMAGE_MODEL, prompt: "a pc", size: "1536x1024", output_compression: 60 });
  });

  it("sniffs the stored content type from magic bytes", () => {
    expect(sniffContentType(WEBP_MAGIC)).toBe("image/webp");
    expect(sniffContentType(PNG)).toBe("image/png");
    expect(sniffContentType(new Uint8Array([0, 1, 2, 3, 4]))).toBe("application/octet-stream");
  });
});
