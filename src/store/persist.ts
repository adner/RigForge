/** Catalog-safe local build persistence. Only ids/enums and successful render metadata are stored. */
import { z } from "zod";
import { RENDER_ANGLES, RENDER_FLAIR_MAX_LENGTH, RENDER_STYLES, allParts } from "../engine";
import { hashBuild } from "./hash";
import { sharePayloadSchema, type SharePayload } from "./share";
import { useStore, type RenderArtifact, type Result, type StoreState } from "./index";

export const BUILD_STORAGE_KEY = "rigbuilder.build.v1";
export const LEGACY_BUILD_STORAGE_KEY = "rigforge.build.v1";

const persistedRenderBaseSchema = z
  .object({
    renderId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
    buildHash: z.string().regex(/^[0-9a-f]{64}$/),
    imageUrl: z.string().regex(/^\/api\/render\/[0-9a-f]{64}\.webp$/),
    style: z.enum(RENDER_STYLES),
    angle: z.enum(RENDER_ANGLES),
    flair: z.string().max(RENDER_FLAIR_MAX_LENGTH).optional(),
    createdAt: z.string(),
    cached: z.boolean().optional(),
  })
  .strict();

const legacyPersistedRenderSchema = persistedRenderBaseSchema;
const persistedRenderSchema = persistedRenderBaseSchema
  .extend({
    forBuildRevision: z.number().int().min(0),
    status: z.enum(["active", "superseded"]),
  })
  .strict();

const persistedBuildSchema = z
  .object({
    version: z.literal(1),
    savedAt: z.string(),
    buildRevision: z.number().int().min(0),
    payload: sharePayloadSchema,
    /** Pre-gallery format; retained so existing browsers can migrate without losing their render. */
    render: legacyPersistedRenderSchema.optional(),
    renders: z.array(persistedRenderSchema).max(100).optional(),
  })
  .strict();

export interface PersistedBuild {
  version: 1;
  savedAt: string;
  buildRevision: number;
  payload: SharePayload;
  render?: Pick<RenderArtifact, "renderId" | "buildHash" | "imageUrl" | "style" | "angle" | "flair" | "createdAt" | "cached">;
  renders?: Pick<RenderArtifact, "renderId" | "forBuildRevision" | "buildHash" | "imageUrl" | "status" | "style" | "angle" | "flair" | "createdAt" | "cached">[];
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function persistedBuildFromState(state: StoreState, now: Date = new Date()): PersistedBuild {
  const payload: SharePayload = { v: 1, parts: allParts(state.build).map((part) => part.id) };
  if (state.goal) payload.goal = state.goal;
  const renders = state.renders.filter(
    (render) =>
      (render.status === "active" || render.status === "superseded") &&
      /^[A-Za-z0-9_-]{1,128}$/.test(render.renderId) &&
      /^[0-9a-f]{64}$/.test(render.buildHash) &&
      /^\/api\/render\/[0-9a-f]{64}\.webp$/.test(render.imageUrl),
  );
  const persisted: PersistedBuild = { version: 1, savedAt: now.toISOString(), buildRevision: state.buildRevision, payload };
  if (renders.length) {
    persisted.renders = renders.slice(-100).map((render) => ({
      renderId: render.renderId,
      forBuildRevision: render.forBuildRevision,
      buildHash: render.buildHash,
      imageUrl: render.imageUrl,
      status: render.status as "active" | "superseded",
      style: render.style,
      angle: render.angle,
      ...(render.flair ? { flair: render.flair } : {}),
      createdAt: render.createdAt,
      ...(render.cached !== undefined ? { cached: render.cached } : {}),
    }));
  }
  return persisted;
}

export function readPersistedBuild(storage: StorageLike): PersistedBuild | null {
  try {
    const current = storage.getItem(BUILD_STORAGE_KEY);
    const raw = current ?? storage.getItem(LEGACY_BUILD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = persistedBuildSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    if (current === null) storage.setItem(BUILD_STORAGE_KEY, raw);
    return parsed.data as PersistedBuild;
  } catch {
    return null;
  }
}

export function writePersistedBuild(storage: StorageLike, state: StoreState = useStore.getState()): void {
  try {
    storage.setItem(BUILD_STORAGE_KEY, JSON.stringify(persistedBuildFromState(state)));
  } catch {
    // Persistence is a convenience; private/embedded contexts may reject localStorage.
  }
}

export async function restorePersistedBuild(saved: PersistedBuild): Promise<Result> {
  const result = useStore.getState().loadBuild(saved.payload, "human", { detail: `restored build saved ${saved.savedAt}` }, saved.buildRevision + 1);
  if (!result.ok) return result;
  const state = useStore.getState();
  const renders = saved.renders ?? (saved.render ? [{ ...saved.render, forBuildRevision: state.buildRevision, status: "active" as const }] : []);
  for (const render of renders) {
    if (render.status === "superseded") {
      state.addRender(render);
      continue;
    }
    try {
      const currentHash = await hashBuild(state.build, state.goal, render.style, render.angle, render.flair);
      if (currentHash === render.buildHash) {
        state.addRender({ ...render, forBuildRevision: state.buildRevision, status: "active" });
      }
    } catch {
      // A catalog change can make an active saved render no longer describe this build; omit it.
    }
  }
  return result;
}

let stopSubscription: (() => void) | null = null;

export function startBuildPersistence(storage: StorageLike): () => void {
  if (stopSubscription) return stopSubscription;
  writePersistedBuild(storage);
  stopSubscription = useStore.subscribe((state, previous) => {
    if (state.build !== previous.build || state.goal !== previous.goal || state.buildRevision !== previous.buildRevision || state.renders !== previous.renders) {
      writePersistedBuild(storage, state);
    }
  });
  return stopSubscription;
}

export function stopBuildPersistence(): void {
  stopSubscription?.();
  stopSubscription = null;
}
