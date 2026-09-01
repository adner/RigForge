import { beforeEach, describe, expect, it } from "vitest";
import * as F from "../engine/__fixtures__/parts";
import { indexCatalog } from "../engine";
import { useStore } from "./index";

const seed = () => {
  useStore.getState().resetAll();
  useStore.getState().setCatalog(F.CATALOG, { catalogVersion: 7, source: "seed", snapshotDate: "2026-08-29" });
};
const st = () => useStore.getState();
const ids = (c: "cpu" | "ram" | "storage" | "gpu" | "case") => (st().build.slots[c] ?? []).map((p) => p.id);

beforeEach(seed);

describe("store mutations", () => {
  it("addPart bumps revision, recomputes conflicts, logs feed + history", () => {
    const r = st().addPart(F.cpu265k.id, {}, "agent", { toolName: "add_part" });
    expect(r.ok).toBe(true);
    expect(st().buildRevision).toBe(1);
    const r2 = st().addPart(F.mbB650Atx.id, {}, "human");
    expect(r2).toMatchObject({ ok: true, buildRevision: 2, delta: { added: ["SOCKET_MISMATCH"], removed: [] } });
    expect(st().conflicts.map((c) => c.code)).toContain("SOCKET_MISMATCH");
    expect(st().history).toHaveLength(2);
    const human = st().feed.at(-1)!;
    expect(human.actor).toBe("human");
    expect(human.title).toBe("👤 changed motherboard — the agent will see this on its next call (rev 2)");
    expect(human.undo).toBe("available");
    const agent = st().feed[0]!;
    expect(agent.kind).toBe("tool");
    expect(agent.toolName).toBe("add_part");
  });

  it("SLOT_OCCUPIED unless replace; replace works; unknown part rejected", () => {
    st().addPart(F.cpu9800x3d.id, {}, "agent");
    expect(st().addPart(F.cpu9600x.id, {}, "agent")).toMatchObject({ ok: false, code: "SLOT_OCCUPIED" });
    expect(st().buildRevision).toBe(1);
    expect(st().addPart(F.cpu9600x.id, { replace: true }, "agent").ok).toBe(true);
    expect(ids("cpu")).toEqual([F.cpu9600x.id]);
    expect(st().addPart("cpu-nope", {}, "agent")).toMatchObject({ ok: false, code: "UNKNOWN_PART" });
  });

  it("multi-slot append + replacesPartId + removePart by category", () => {
    st().addPart(F.ssdNvmeGen4_1tb.id, {}, "agent");
    st().addPart(F.ssdSata1tb.id, {}, "agent");
    expect(ids("storage")).toEqual([F.ssdNvmeGen4_1tb.id, F.ssdSata1tb.id]);
    st().addPart(F.ssdSata2tb.id, { replacesPartId: F.ssdSata1tb.id }, "agent");
    expect(ids("storage")).toEqual([F.ssdNvmeGen4_1tb.id, F.ssdSata2tb.id]);
    expect(st().removePart({ category: "storage" }, "human").ok).toBe(true);
    expect(ids("storage")).toEqual([]);
    expect(st().removePart({ category: "storage" }, "human")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(st().removePart({ partId: F.cpu9800x3d.id }, "human")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("setGoal counts as build state; identical goal is a no-op", () => {
    const g = { useCase: "gaming" as const, budgetUSD: 1000 };
    expect(st().setGoal(g, "agent")).toMatchObject({ ok: true, buildRevision: 1 });
    expect(st().setGoal({ ...g }, "agent")).toMatchObject({ ok: true, buildRevision: 1, notice: "goal unchanged" });
    expect(st().conflicts.map((c) => c.code)).toContain("GOAL_SLOT_MISSING");
  });

  it("resetBuild clears everything and is undoable", () => {
    for (const p of F.GOOD_PARTS) st().addPart(p.id, {}, "agent");
    st().setGoal({ useCase: "gaming", budgetUSD: 3000 }, "agent");
    const rev = st().buildRevision;
    const r = st().resetBuild("agent");
    expect(r).toMatchObject({ ok: true, buildRevision: rev + 1 });
    expect(Object.keys(st().build.slots)).toEqual([]);
    expect(st().goal).toBeUndefined();
    expect(st().undoLast("human").ok).toBe(true);
    expect(ids("cpu")).toEqual([F.cpu9800x3d.id]);
    expect(st().goal?.budgetUSD).toBe(3000);
  });

  it("loadBuild drops unknown ids with a notice and replaces the build", () => {
    st().addPart(F.cpu9800x3d.id, {}, "agent");
    const r = st().loadBuild({ v: 1, parts: [F.gpu5070.id, "gpu-ghost", F.caseItx15l.id], goal: { useCase: "office", budgetUSD: 800 } }, "human");
    expect(r).toMatchObject({ ok: true, dropped: ["gpu-ghost"] });
    expect(ids("cpu")).toEqual([]);
    expect(ids("gpu")).toEqual([F.gpu5070.id]);
    expect(st().goal?.useCase).toBe("office");
    expect(st().feed.at(-1)!.title).toMatch(/dropped/);
  });
});

describe("guarded undo", () => {
  it("undo applies the inverse when the slot is unchanged, and bumps revision", () => {
    st().addPart(F.cpu9800x3d.id, {}, "agent");
    const r = st().addPart(F.cpu9600x.id, { replace: true }, "agent");
    if (!r.ok) throw new Error("expected ok");
    expect(st().undo(r.historyId!, "human")).toMatchObject({ ok: true, buildRevision: 3 });
    expect(ids("cpu")).toEqual([F.cpu9800x3d.id]);
    expect(st().feed.find((f) => f.historyId === r.historyId)!.undo).toBe("none");
    expect(st().feed.at(-1)!.detail).toMatch(/undid/);
    expect(st().feed.at(-1)!.title).toMatch(/^👤 changed CPU/);
  });

  it("undo is superseded when the slot changed afterwards; feed row marked", () => {
    const r1 = st().addPart(F.gpu5070.id, {}, "agent");
    if (!r1.ok) throw new Error();
    st().addPart(F.gpu5080.id, { replace: true }, "human");
    const u = st().undo(r1.historyId!, "agent");
    expect(u).toMatchObject({ ok: false, code: "UNDO_SUPERSEDED" });
    expect(st().feed.find((f) => f.historyId === r1.historyId)!.undo).toBe("superseded");
    expect(ids("gpu")).toEqual([F.gpu5080.id]);
    // top of stack still works
    expect(st().undoLast("human").ok).toBe(true);
    expect(ids("gpu")).toEqual([F.gpu5070.id]);
  });

  it("undo of a goal change is guarded by the goal", () => {
    const r = st().setGoal({ useCase: "ml", budgetUSD: 5000 }, "agent");
    if (!r.ok) throw new Error();
    st().setGoal({ useCase: "ml", budgetUSD: 4000 }, "human");
    expect(st().undo(r.historyId!, "agent")).toMatchObject({ ok: false, code: "UNDO_SUPERSEDED" });
    expect(st().undo("h_nope", "agent")).toMatchObject({ ok: false, code: "NOTHING_TO_UNDO" });
  });

  it("undo of a multi-slot change in a different category is unaffected", () => {
    const r = st().addPart(F.ssdSata1tb.id, {}, "agent");
    if (!r.ok) throw new Error();
    st().addPart(F.cpu9800x3d.id, {}, "human");
    expect(st().undo(r.historyId!, "human").ok).toBe(true);
    expect(ids("storage")).toEqual([]);
    expect(ids("cpu")).toEqual([F.cpu9800x3d.id]);
  });
});

describe("renders", () => {
  it("never change buildRevision; active renders are superseded when the build changes", async () => {
    for (const p of F.GOOD_PARTS) st().addPart(p.id, {}, "agent");
    const rev = st().buildRevision;
    const { hashBuild } = await import("./hash");
    const h = await hashBuild(st().build, st().goal, "photoreal", "front");
    st().addRender({ renderId: "r1", forBuildRevision: rev, buildHash: h, imageUrl: "/api/render/x.webp", status: "active", style: "photoreal", angle: "front", createdAt: "now" });
    expect(st().buildRevision).toBe(rev);
    // A change that does not affect the prompt keeps the render active.
    st().addPart(F.ssdSata1tb.id, {}, "human");
    await new Promise((r) => setTimeout(r, 10));
    expect(st().renders[0]!.status).toBe("active");
    // Swapping the case changes the prompt → superseded.
    st().addPart(F.caseMidAtxWhiteGlass.id, { replace: true }, "human");
    await new Promise((r) => setTimeout(r, 10));
    expect(st().renders[0]!.status).toBe("superseded");
  });

  it("removes a render artifact without changing the build revision", () => {
    st().addRender({ renderId: "r1", forBuildRevision: 4, buildHash: "h", imageUrl: "/api/render/x.webp", status: "superseded", style: "studio", angle: "side", createdAt: "now" });
    const rev = st().buildRevision;
    st().removeRender("r1");
    expect(st().renders).toEqual([]);
    expect(st().buildRevision).toBe(rev);
  });
});

describe("setCatalog", () => {
  it("re-points build parts at the new catalog and drops missing ids with a note", () => {
    st().addPart(F.cpu9800x3d.id, {}, "agent");
    st().addPart(F.gpu5070.id, {}, "agent");
    const smaller = indexCatalog(F.FIXTURE_PARTS.filter((p) => p.id !== F.gpu5070.id));
    st().setCatalog(smaller, { catalogVersion: 8, source: "network" });
    expect(ids("cpu")).toEqual([F.cpu9800x3d.id]);
    expect(ids("gpu")).toEqual([]);
    expect(st().catalogVersion).toBe(8);
    expect(st().feed.at(-1)!.title).toMatch(/no longer available/);
  });
});
