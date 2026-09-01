import { beforeEach, describe, expect, it } from "vitest";
import * as F from "../engine/__fixtures__/parts";
import {
  BUILD_STORAGE_KEY,
  LEGACY_BUILD_STORAGE_KEY,
  persistedBuildFromState,
  readPersistedBuild,
  restorePersistedBuild,
  stopBuildPersistence,
  writePersistedBuild,
} from "./persist";
import { hashBuild, useStore } from "./index";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const seed = () => {
  stopBuildPersistence();
  useStore.getState().resetAll();
  useStore.getState().setCatalog(F.CATALOG, { catalogVersion: 7, source: "seed", snapshotDate: "2026-08-29" });
};

beforeEach(seed);

describe("local build persistence", () => {
  it("stores the versioned id payload, revision, and successful render history", async () => {
    const state = useStore.getState();
    state.addPart(F.caseItx15l.id, {}, "human");
    state.addPart(F.gpu5070.id, {}, "human");
    state.setGoal({ useCase: "gaming", budgetUSD: 1500 }, "human");
    const flair = "a turtle sticker on the glass";
    const hash = await hashBuild(useStore.getState().build, useStore.getState().goal, "studio", "front", flair);
    state.addRender({ renderId: "r_agent_1", forBuildRevision: 2, buildHash: hash, imageUrl: `/api/render/${hash}.webp`, status: "superseded", style: "studio", angle: "side", createdAt: "2026-08-29T11:00:00.000Z" });
    state.addRender({ renderId: hash, forBuildRevision: 3, buildHash: hash, imageUrl: `/api/render/${hash}.webp`, status: "active", style: "studio", angle: "front", flair, createdAt: "2026-08-29T12:00:00.000Z" });
    state.addRender({ renderId: "pending", forBuildRevision: 3, buildHash: hash, imageUrl: "", status: "pending", style: "studio", angle: "side", createdAt: "now" });

    const saved = persistedBuildFromState(useStore.getState(), new Date("2026-08-29T13:00:00.000Z"));
    expect(saved).toMatchObject({
      version: 1,
      savedAt: "2026-08-29T13:00:00.000Z",
      buildRevision: 3,
      payload: { v: 1, parts: [F.gpu5070.id, F.caseItx15l.id], goal: { useCase: "gaming", budgetUSD: 1500 } },
      renders: [
        { renderId: "r_agent_1", forBuildRevision: 2, status: "superseded", imageUrl: `/api/render/${hash}.webp` },
        { renderId: hash, forBuildRevision: 3, status: "active", imageUrl: `/api/render/${hash}.webp`, flair },
      ],
    });
    expect(JSON.stringify(saved)).not.toContain("history");
    expect(JSON.stringify(saved)).not.toContain("conflicts");
  });

  it("round-trips through storage and restores via the current catalog above the saved revision", async () => {
    const storage = new MemoryStorage();
    useStore.getState().addPart(F.cpu9800x3d.id, {}, "human");
    useStore.getState().addPart(F.caseItx15l.id, {}, "human");
    writePersistedBuild(storage);
    const saved = readPersistedBuild(storage)!;
    expect(saved.payload.parts).toEqual([F.cpu9800x3d.id, F.caseItx15l.id]);

    useStore.getState().resetAll();
    const restored = await restorePersistedBuild(saved);
    expect(restored).toMatchObject({ ok: true, buildRevision: saved.buildRevision + 1 });
    expect(useStore.getState().build.slots.cpu?.[0].id).toBe(F.cpu9800x3d.id);
    expect(useStore.getState().buildRevision).toBe(saved.buildRevision + 1);
  });

  it("migrates a valid RigForge storage entry to the RigBuilder key", () => {
    const storage = new MemoryStorage();
    const legacy = persistedBuildFromState(useStore.getState(), new Date("2026-08-29T13:00:00.000Z"));
    storage.setItem(LEGACY_BUILD_STORAGE_KEY, JSON.stringify(legacy));

    expect(readPersistedBuild(storage)).toEqual(legacy);
    expect(storage.getItem(BUILD_STORAGE_KEY)).toBe(JSON.stringify(legacy));
  });

  it("round-trips active and superseded renders, including agent render ids", async () => {
    const storage = new MemoryStorage();
    useStore.getState().addPart(F.caseItx15l.id, {}, "human");
    const state = useStore.getState();
    const hash = await hashBuild(state.build, state.goal, "studio", "front");
    state.addRender({ renderId: "r_agent_1", forBuildRevision: 1, buildHash: hash, imageUrl: `/api/render/${hash}.webp`, status: "superseded", style: "studio", angle: "side", createdAt: "2026-08-29T11:00:00.000Z" });
    state.addRender({ renderId: hash, forBuildRevision: 1, buildHash: hash, imageUrl: `/api/render/${hash}.webp`, status: "active", style: "studio", angle: "front", createdAt: "2026-08-29T12:00:00.000Z" });
    writePersistedBuild(storage);
    const saved = readPersistedBuild(storage)!;

    useStore.getState().resetAll();
    await restorePersistedBuild(saved);

    expect(useStore.getState().renders).toMatchObject([
      { renderId: "r_agent_1", status: "superseded", forBuildRevision: 1 },
      { renderId: hash, status: "active", forBuildRevision: saved.buildRevision + 1 },
    ]);
  });

  it("restores the legacy single-render format", async () => {
    useStore.getState().addPart(F.caseItx15l.id, {}, "human");
    const state = useStore.getState();
    const hash = await hashBuild(state.build, state.goal, "studio", "front");
    const saved = persistedBuildFromState(state);
    delete saved.renders;
    saved.render = { renderId: hash, buildHash: hash, imageUrl: `/api/render/${hash}.webp`, style: "studio", angle: "front", createdAt: "2026-08-29T12:00:00.000Z" };

    useStore.getState().resetAll();
    await restorePersistedBuild(saved);

    expect(useStore.getState().renders).toMatchObject([{ renderId: hash, status: "active" }]);
  });

  it("drops missing catalog ids and ignores malformed local data", async () => {
    const storage = new MemoryStorage();
    storage.setItem(BUILD_STORAGE_KEY, "not-json");
    expect(readPersistedBuild(storage)).toBeNull();
    const saved = {
      version: 1 as const,
      savedAt: "2026-08-29T12:00:00.000Z",
      buildRevision: 9,
      payload: { v: 1 as const, parts: [F.caseItx15l.id, "gpu-removed"] },
    };
    const result = await restorePersistedBuild(saved);
    expect(result).toMatchObject({ ok: true, buildRevision: 10, dropped: ["gpu-removed"] });
  });
});
