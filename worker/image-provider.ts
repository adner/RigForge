/**
 * Image generation behind a tiny interface so routes/tests never touch the network.
 * OpenAI Images API (`gpt-image-2`) implementation; provider URLs and prompts are never
 * logged or exposed (DESIGN.md §4.3, §8).
 *
 * Two operations:
 *   generate(prompt)          text-to-image      → /v1/images/generations
 *   compose(prompt, images)   image composition  → /v1/images/edits (multipart, `image[]`)
 * `compose` is the Phase 2 part-card path (docs/RENDER_FIDELITY.md): the reference images are
 * always read server-side from R2, never supplied by the client.
 */
import { ApiError } from "./http";

export interface GenerateOptions {
  signal?: AbortSignal;
  /** "landscape" → 1536x1024 when supported, else 1024x1024. */
  aspect?: "square" | "landscape";
}

export interface GeneratedImage {
  bytes: Uint8Array;
  contentType: string;
}

/** A reference image handed to `compose` (a published part card). */
export interface ReferenceImage {
  bytes: Uint8Array;
  contentType: string;
}

export interface ImageProvider {
  readonly name: string;
  generate(prompt: string, opts?: GenerateOptions): Promise<GeneratedImage>;
  /** Composes one image from `images` (order is meaningful — the prompt names them). */
  compose(prompt: string, images: readonly ReferenceImage[], opts?: GenerateOptions): Promise<GeneratedImage>;
}

export const OPENAI_IMAGE_MODEL = "gpt-image-2";
const OPENAI_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";
/** gpt-image-2 accepts several reference images; keep a sane server-side ceiling. */
export const MAX_REFERENCE_IMAGES = 8;

const b64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Content type from magic bytes (the API may ignore `output_format` on some models). */
export const sniffContentType = (b: Uint8Array): string => {
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return "application/octet-stream";
};

interface OpenAiImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string; param?: string | null };
}

/** Optional knobs the model may reject; a 400 naming one of them triggers the minimal retry. */
const OPTIONAL_PARAMS = ["output_format", "output_compression", "quality", "size"];

const sizeFor = (aspect: GenerateOptions["aspect"]): string => (aspect === "square" ? "1024x1024" : "1536x1024");

const EXT: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" };

export function openAiProvider(apiKey: string, fetchFn: typeof fetch = fetch, model = OPENAI_IMAGE_MODEL): ImageProvider {
  const post = (url: string, body: BodyInit, headers: Record<string, string>, signal?: AbortSignal): Promise<Response> =>
    fetchFn(url, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, ...headers }, body, signal });

  const json = (body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> =>
    post(OPENAI_URL, JSON.stringify(body), { "content-type": "application/json" }, signal);

  /** Multipart body; `content-type` is set by fetch so the boundary matches. */
  const multipart = (fields: Record<string, string>, images: readonly ReferenceImage[], signal?: AbortSignal): Promise<Response> => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    images.forEach((img, i) => {
      const ext = EXT[img.contentType] ?? "png";
      fd.append("image[]", new Blob([img.bytes], { type: img.contentType }), `card-${i + 1}.${ext}`);
    });
    return post(OPENAI_EDITS_URL, fd, {}, signal);
  };

  /** Shared error hygiene: status codes only, never the prompt, the body or the provider text. */
  const send = async (call: () => Promise<Response>, retry: (() => Promise<Response>) | null, signal?: AbortSignal): Promise<GeneratedImage> => {
    let res: Response;
    try {
      res = await call();
      // If the model rejects one of the optional knobs, retry once with the minimal body.
      if (res.status === 400 && retry) {
        const err = ((await res.clone().json().catch(() => ({}))) as OpenAiImageResponse).error;
        if (err?.param && OPTIONAL_PARAMS.includes(err.param)) res = await retry();
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw new ApiError(504, "RENDER_FAILED", "Image generation timed out");
      throw new ApiError(502, "RENDER_FAILED", "Image provider unreachable");
    }
    if (res.status === 429) throw new ApiError(429, "RENDER_RATE_LIMITED", "Image provider is rate limiting", { retryAfterSec: 60 });
    if (!res.ok) {
      // Status only — provider error text can echo the prompt.
      console.error("image provider error", res.status);
      throw new ApiError(502, "RENDER_FAILED", `Image provider returned ${res.status}`);
    }
    const body = (await res.json()) as OpenAiImageResponse;
    const item = body.data?.[0];
    let bytes: Uint8Array;
    if (item?.b64_json) bytes = b64ToBytes(item.b64_json);
    else if (item?.url) {
      const img = await fetchFn(item.url, { signal });
      if (!img.ok) throw new ApiError(502, "RENDER_FAILED", "Could not download generated image");
      bytes = new Uint8Array(await img.arrayBuffer());
    } else throw new ApiError(502, "RENDER_FAILED", "Image provider returned no image");
    return { bytes, contentType: sniffContentType(bytes) };
  };

  return {
    name: "openai",
    generate(prompt, opts = {}) {
      const rich = {
        model,
        prompt,
        n: 1,
        size: sizeFor(opts.aspect),
        quality: "medium",
        output_format: "webp",
        // Verified 2026-08-29: gpt-image-2 returns ~1.4 MB at default compression for
        // 1536x1024 webp; DESIGN §4.3 targets ≤ 400 KB.
        output_compression: 60,
      };
      return send(
        () => json(rich, opts.signal),
        () => json({ model, prompt, n: 1, size: "1024x1024" }, opts.signal),
        opts.signal,
      );
    },
    compose(prompt, images, opts = {}) {
      if (!images.length) throw new ApiError(502, "RENDER_FAILED", "Composition needs at least one reference image");
      const refs = images.slice(0, MAX_REFERENCE_IMAGES);
      const rich = {
        model,
        prompt,
        n: "1",
        size: sizeFor(opts.aspect),
        quality: "medium",
        output_format: "webp",
        output_compression: "60",
      };
      return send(
        () => multipart(rich, refs, opts.signal),
        () => multipart({ model, prompt, n: "1", size: "1024x1024" }, refs, opts.signal),
        opts.signal,
      );
    },
  };
}

export const WEBP_MAGIC = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

export interface ComposeCall {
  prompt: string;
  /** Number of reference images the route handed over. */
  images: number;
  contentTypes: string[];
}

export interface FakeProvider extends ImageProvider {
  calls: string[];
  composeCalls: ComposeCall[];
  fail?: ApiError;
}

/** Test double: returns fixed bytes and records the prompts (and reference images) it was given. */
export const fakeProvider = (bytes: Uint8Array = WEBP_MAGIC, contentType = "image/webp"): FakeProvider => {
  const provider: FakeProvider = {
    name: "fake",
    calls: [],
    composeCalls: [],
    async generate(prompt) {
      provider.calls.push(prompt);
      if (provider.fail) throw provider.fail;
      return { bytes, contentType };
    },
    async compose(prompt, images) {
      provider.calls.push(prompt);
      provider.composeCalls.push({ prompt, images: images.length, contentTypes: images.map((i) => i.contentType) });
      if (provider.fail) throw provider.fail;
      return { bytes, contentType };
    },
  };
  return provider;
};
