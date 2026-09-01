/**
 * Content-addressed render storage: R2 `renders/<hash>.webp` with the build metadata as
 * custom metadata (DESIGN.md §4.3). Memory-backed variant for tests.
 */

/**
 * How the image was produced (docs/RENDER_FIDELITY.md Phase 2): "text" is the deterministic
 * text-to-image prompt, "composed" is an edits call seeded with the build's part cards.
 */
export type RenderMode = "text" | "composed";

export interface RenderMeta {
  buildHash: string;
  createdAt: string;
  style: string;
  angle: string;
  mode: RenderMode;
}

export interface StoredRender {
  body: ReadableStream | Uint8Array;
  contentType: string;
  size: number;
  meta: RenderMeta;
}

export interface RenderStore {
  exists(hash: string): Promise<boolean>;
  get(hash: string): Promise<StoredRender | null>;
  put(hash: string, bytes: Uint8Array, contentType: string, meta: RenderMeta): Promise<void>;
}

export const renderKey = (hash: string): string => `renders/${hash}.webp`;

export const r2Store = (bucket: R2Bucket): RenderStore => ({
  async exists(hash) {
    return (await bucket.head(renderKey(hash))) !== null;
  },
  async get(hash) {
    const obj = await bucket.get(renderKey(hash));
    if (!obj) return null;
    const m = obj.customMetadata ?? {};
    return {
      body: obj.body,
      contentType: obj.httpMetadata?.contentType ?? "image/webp",
      size: obj.size,
      meta: {
        buildHash: m.buildHash ?? hash,
        createdAt: m.createdAt ?? "",
        style: m.style ?? "",
        angle: m.angle ?? "",
        mode: m.mode === "composed" ? "composed" : "text",
      },
    };
  },
  async put(hash, bytes, contentType, meta) {
    await bucket.put(renderKey(hash), bytes, {
      httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { ...meta },
    });
  },
});

export interface MemoryRenderStore extends RenderStore {
  objects: Map<string, { bytes: Uint8Array; contentType: string; meta: RenderMeta }>;
}

export const memoryStore = (): MemoryRenderStore => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string; meta: RenderMeta }>();
  return {
    objects,
    async exists(hash) {
      return objects.has(hash);
    },
    async get(hash) {
      const o = objects.get(hash);
      return o ? { body: o.bytes, contentType: o.contentType, size: o.bytes.byteLength, meta: o.meta } : null;
    },
    async put(hash, bytes, contentType, meta) {
      objects.set(hash, { bytes, contentType, meta });
    },
  };
};
