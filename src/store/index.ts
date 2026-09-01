/**
 * RigBuilder app store (Zustand). Single source of truth for catalog, build, goal, revision counter,
 * validation, render artifacts, activity feed and the guarded undo history (DESIGN §4.5, §7.2).
 *
 * Usable outside React via `useStore.getState()` / `useStore.subscribe()`.
 * Every build/goal mutation: bumps `buildRevision`, recomputes `conflicts`, pushes a HistoryEntry
 * with guarded inverse ops and logs a FeedItem. Renders never touch `buildRevision`.
 */
import { create } from "zustand";
import { CATEGORIES, type Category, type Part } from "../data/schema";
import {
  LABEL,
  SlotOccupiedError,
  emptyBuild,
  partsIn,
  validate,
  validationDelta,
  withPart,
  withoutCategory,
  withoutPart,
  type Build,
  type CatalogIndex,
  type Conflict,
  type Goal,
  type RenderAngle,
  type RenderStyle,
  type RuleCode,
  type ValidationDelta,
} from "../engine";
import { hashBuild } from "./hash";

// ---------- types ----------

export type Actor = "agent" | "human";

export type RenderStatus = "active" | "superseded" | "pending" | "failed";

export interface RenderArtifact {
  renderId: string;
  forBuildRevision: number;
  buildHash: string;
  imageUrl: string;
  status: RenderStatus;
  style: RenderStyle;
  angle: RenderAngle;
  /** Optional render-only cosmetic request; not part of the PC build or buildRevision. */
  flair?: string;
  createdAt: string;
  cached?: boolean;
  error?: string;
}

export type FeedKind = "tool" | "action" | "note";
export type UndoState = "available" | "superseded" | "none";

export interface FeedItem {
  id: string;
  at: string;
  actor: Actor;
  kind: FeedKind;
  title: string;
  detail?: string;
  toolName?: string;
  buildRevision: number;
  undo?: UndoState;
  historyId?: string;
  resultSummary?: string;
  error?: string;
}

/** Replayable build operation; inverses are expressed with `setSlot` / `setGoal` so they are exact. */
export type BuildOp =
  | { op: "add"; partId: string; replace?: boolean; replacesPartId?: string }
  | { op: "remove"; partId: string }
  | { op: "removeCategory"; category: Category }
  | { op: "setSlot"; category: Category; partIds: string[] }
  | { op: "setGoal"; goal: Goal | null };

export interface HistoryGuard {
  category: Category;
  expectPartIds: string[];
}

export interface HistoryEntry {
  id: string;
  at: string;
  actor: Actor;
  /** Revision this entry produced. */
  revision: number;
  /** Ops that restore the pre-mutation state (applied in order). */
  inverse: BuildOp[];
  /** Undo is allowed only if each category still holds exactly `expectPartIds`. */
  guard: HistoryGuard[];
  /** Goal the entry left behind (undefined = untouched by this entry, null = no goal). */
  expectGoal?: Goal | null;
  /** One-line label for the feed. */
  label: string;
}

export type ErrorCode =
  | "UNKNOWN_PART"
  | "SLOT_OCCUPIED"
  | "INVALID_INPUT"
  | "NOTHING_TO_UNDO"
  | "UNDO_SUPERSEDED"
  | "NO_CATALOG"
  | "INTERNAL";

export type Result =
  | { ok: true; buildRevision: number; delta: ValidationDelta; historyId?: string; dropped?: string[]; notice?: string }
  | { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> };

export interface CatalogMeta {
  catalogVersion: number;
  source: "network" | "cache" | "seed";
  snapshotDate?: string;
}

export interface MutationMeta {
  /** Tool that triggered the mutation (agent actor); shown in the feed row. */
  toolName?: string;
  detail?: string;
}

export interface LoadPayload {
  v: 1;
  parts: string[];
  goal?: Goal;
}

export interface StoreState {
  catalog: CatalogIndex | null;
  catalogVersion: number | null;
  catalogSource: "network" | "cache" | "seed" | null;
  snapshotDate?: string;
  build: Build;
  goal?: Goal;
  buildRevision: number;
  renders: RenderArtifact[];
  feed: FeedItem[];
  history: HistoryEntry[];
  /** Memoized validate(build, goal); recomputed on every mutation. */
  conflicts: Conflict[];
}

export interface StoreActions {
  setCatalog(catalog: CatalogIndex, meta: CatalogMeta): void;
  addPart(partId: string, opts: { replace?: boolean; replacesPartId?: string }, actor: Actor, meta?: MutationMeta): Result;
  removePart(target: { partId?: string; category?: Category }, actor: Actor, meta?: MutationMeta): Result;
  setGoal(goal: Goal | null, actor: Actor, meta?: MutationMeta): Result;
  resetBuild(actor: Actor, meta?: MutationMeta): Result;
  undo(historyId: string, actor: Actor): Result;
  undoLast(actor: Actor): Result;
  loadBuild(payload: LoadPayload, actor: Actor, meta?: MutationMeta, revisionFloor?: number): Result;
  addRender(r: RenderArtifact): void;
  updateRender(renderId: string, patch: Partial<RenderArtifact>): void;
  removeRender(renderId: string): void;
  logFeed(item: Omit<FeedItem, "id" | "at" | "buildRevision"> & Partial<Pick<FeedItem, "id" | "at" | "buildRevision">>): FeedItem;
  /** Test/reset helper: clears build, goal, revision, renders, feed, history (keeps the catalog). */
  resetAll(): void;
}

export type Store = StoreState & StoreActions;

// ---------- helpers ----------

let idCounter = 0;
export const newId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${(++idCounter).toString(36)}`;
const now = () => new Date().toISOString();

const slotIds = (build: Build, category: Category): string[] => partsIn(build, category).map((p) => p.id);
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameGoal = (a?: Goal | null, b?: Goal | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const fail = (code: ErrorCode, message: string, details?: Record<string, unknown>): Result => ({ ok: false, code, message, details });

class OpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Applies ops to a build/goal pair without touching the store. Throws OpError. Exported for validate_build. */
export function applyOps(
  catalog: CatalogIndex,
  build: Build,
  goal: Goal | undefined,
  ops: readonly BuildOp[],
): { build: Build; goal: Goal | undefined } {
  let b = build;
  let g = goal;
  const lookup = (id: string): Part => {
    const p = catalog.byId.get(id);
    if (!p) throw new OpError("UNKNOWN_PART", `unknown part id "${id}"`, { partId: id });
    return p;
  };
  for (const op of ops) {
    switch (op.op) {
      case "add": {
        const part = lookup(op.partId);
        if (op.replacesPartId) lookup(op.replacesPartId);
        try {
          b = withPart(b, part, { replace: op.replace, replacesPartId: op.replacesPartId });
        } catch (e) {
          if (e instanceof SlotOccupiedError) {
            throw new OpError("SLOT_OCCUPIED", `${LABEL[e.category]} slot is occupied by ${e.occupiedBy}; pass replace: true to swap`, {
              category: e.category,
              occupiedBy: e.occupiedBy,
            });
          }
          throw e;
        }
        break;
      }
      case "remove":
        lookup(op.partId);
        b = withoutPart(b, op.partId);
        break;
      case "removeCategory":
        b = withoutCategory(b, op.category);
        break;
      case "setSlot": {
        b = withoutCategory(b, op.category);
        for (const id of op.partIds) b = withPart(b, lookup(id));
        break;
      }
      case "setGoal":
        g = op.goal ?? undefined;
        break;
    }
  }
  return { build: b, goal: g };
}

const humanTitle = (slots: Category[], rev: number, verb = "changed"): string => {
  const what = slots.length ? slots.map((c) => LABEL[c]).join(", ") : "the build";
  return `👤 ${verb} ${what} — the agent will see this on its next call (rev ${rev})`;
};

// ---------- store ----------

export const useStore = create<Store>()((set, get) => {
  /** Core commit: computes delta, revision, history, feed, render supersession. */
  function commit(
    next: { build: Build; goal: Goal | undefined },
    actor: Actor,
    label: string,
    touched: Category[],
    goalTouched: boolean,
    meta?: MutationMeta,
    opts: { undoOf?: string; revisionFloor?: number } = {},
  ): Result {
    const s = get();
    const prevBuild = s.build;
    const prevGoal = s.goal;
    const conflicts = validate(next.build, next.goal);
    const delta = validationDelta(s.conflicts, conflicts);
    const revision = Math.max(s.buildRevision + 1, opts.revisionFloor ?? 0);

    const inverse: BuildOp[] = touched.map((c) => ({ op: "setSlot", category: c, partIds: slotIds(prevBuild, c) }));
    if (goalTouched) inverse.push({ op: "setGoal", goal: prevGoal ?? null });
    const entry: HistoryEntry = {
      id: newId("h"),
      at: now(),
      actor,
      revision,
      inverse,
      guard: touched.map((c) => ({ category: c, expectPartIds: slotIds(next.build, c) })),
      expectGoal: goalTouched ? (next.goal ?? null) : undefined,
      label,
    };
    const feedTitle = actor === "human" ? humanTitle(touched.length ? touched : [], revision, goalTouched && !touched.length ? "changed goal for" : "changed") : `🤖 ${label}`;
    const item: FeedItem = {
      id: newId("f"),
      at: entry.at,
      actor,
      kind: actor === "agent" && meta?.toolName ? "tool" : "action",
      title: feedTitle,
      detail: meta?.detail ?? (actor === "human" ? label : undefined),
      toolName: meta?.toolName,
      buildRevision: revision,
      undo: "available",
      historyId: entry.id,
      resultSummary: summarizeDelta(delta, conflicts),
    };
    set({
      build: next.build,
      goal: next.goal,
      buildRevision: revision,
      conflicts,
      history: [...s.history, entry],
      feed: [...s.feed, item],
    });
    if (opts.undoOf) {
      // The undone row can no longer be undone again (its guard would still pass, but it is confusing).
      set((st) => ({ feed: st.feed.map((f) => (f.historyId === opts.undoOf && f.undo === "available" ? { ...f, undo: "none" } : f)) }));
    }
    void supersedeRenders();
    return { ok: true, buildRevision: revision, delta, historyId: entry.id };
  }

  /** Marks every active render whose hash no longer matches the current build as superseded. */
  async function supersedeRenders(): Promise<void> {
    const s = get();
    const active = s.renders.filter((r) => r.status === "active");
    if (!active.length) return;
    const stale = new Set<string>();
    for (const r of active) {
      try {
        const h = await hashBuild(s.build, s.goal, r.style, r.angle, r.flair);
        if (h !== r.buildHash) stale.add(r.renderId);
      } catch {
        stale.add(r.renderId); // no case any more → cannot match
      }
    }
    if (!stale.size) return;
    set((st) => ({ renders: st.renders.map((r) => (stale.has(r.renderId) && r.status === "active" ? { ...r, status: "superseded" } : r)) }));
  }

  function runOps(ops: BuildOp[]): { build: Build; goal: Goal | undefined } | Result {
    const s = get();
    if (!s.catalog) return fail("NO_CATALOG", "catalog not loaded yet");
    try {
      return applyOps(s.catalog, s.build, s.goal, ops);
    } catch (e) {
      if (e instanceof OpError) return fail(e.code, e.message, e.details);
      return fail("INTERNAL", e instanceof Error ? e.message : String(e));
    }
  }
  const isResult = (x: unknown): x is Result => typeof x === "object" && x !== null && "ok" in x;

  return {
    catalog: null,
    catalogVersion: null,
    catalogSource: null,
    snapshotDate: undefined,
    build: emptyBuild(),
    goal: undefined,
    buildRevision: 0,
    renders: [],
    feed: [],
    history: [],
    conflicts: [],

    setCatalog(catalog, meta) {
      const s = get();
      // Re-point build parts at the new catalog objects where ids still exist (prices may have changed).
      let build = s.build;
      const missing: string[] = [];
      for (const c of CATEGORIES) {
        const cur = partsIn(build, c);
        if (!cur.length) continue;
        build = withoutCategory(build, c);
        for (const p of cur) {
          const fresh = catalog.byId.get(p.id);
          if (fresh) build = withPart(build, fresh);
          else missing.push(p.id);
        }
      }
      set({
        catalog,
        catalogVersion: meta.catalogVersion,
        catalogSource: meta.source,
        snapshotDate: meta.snapshotDate,
        build,
        conflicts: validate(build, s.goal),
      });
      if (missing.length) {
        get().logFeed({ actor: "human", kind: "note", title: `catalog v${meta.catalogVersion} loaded — ${missing.length} part(s) no longer available were removed: ${missing.join(", ")}` });
      }
    },

    addPart(partId, opts, actor, meta) {
      const s = get();
      const part = s.catalog?.byId.get(partId);
      if (!s.catalog) return fail("NO_CATALOG", "catalog not loaded yet");
      if (!part) return fail("UNKNOWN_PART", `unknown part id "${partId}"`, { partId });
      const r = runOps([{ op: "add", partId, replace: opts.replace, replacesPartId: opts.replacesPartId }]);
      if (isResult(r)) return r;
      const before = slotIds(s.build, part.category);
      const replaced = before.filter((id) => !slotIds(r.build, part.category).includes(id));
      const replacedNames = replaced.map((id) => s.catalog!.byId.get(id)?.name ?? "the previous part").join(", ");
      const label = replaced.length ? `replaced ${replacedNames} with ${part.name} in ${LABEL[part.category]}` : `added ${part.name} to ${LABEL[part.category]}`;
      return commit(r, actor, label, [part.category], false, meta);
    },

    removePart(target, actor, meta) {
      const s = get();
      if (!s.catalog) return fail("NO_CATALOG", "catalog not loaded yet");
      if (target.partId) {
        const part = s.catalog.byId.get(target.partId);
        if (!part) return fail("UNKNOWN_PART", `unknown part id "${target.partId}"`, { partId: target.partId });
        if (!slotIds(s.build, part.category).includes(part.id)) {
          return fail("INVALID_INPUT", `${part.id} is not in the build`, { partId: part.id });
        }
        const r = runOps([{ op: "remove", partId: part.id }]);
        if (isResult(r)) return r;
        return commit(r, actor, `removed ${part.name} from ${LABEL[part.category]}`, [part.category], false, meta);
      }
      if (target.category) {
        if (!CATEGORIES.includes(target.category)) return fail("INVALID_INPUT", `unknown category "${String(target.category)}"`);
        const ids = slotIds(s.build, target.category);
        if (!ids.length) return fail("INVALID_INPUT", `${LABEL[target.category]} slot is already empty`, { category: target.category });
        const r = runOps([{ op: "removeCategory", category: target.category }]);
        if (isResult(r)) return r;
        return commit(r, actor, `cleared ${LABEL[target.category]}`, [target.category], false, meta);
      }
      return fail("INVALID_INPUT", "provide partId or category");
    },

    setGoal(goal, actor, meta) {
      const s = get();
      if (sameGoal(s.goal, goal)) {
        return { ok: true, buildRevision: s.buildRevision, delta: { added: [], removed: [] }, notice: "goal unchanged" };
      }
      const next = { build: s.build, goal: goal ?? undefined };
      const label = goal ? `set a ${goal.useCase.replaceAll("-", " ")} goal with a $${goal.budgetUSD.toLocaleString("en-US")} budget` : "cleared the build goal";
      return commit(next, actor, label, [], true, meta);
    },

    resetBuild(actor, meta) {
      const s = get();
      const touched = CATEGORIES.filter((c) => partsIn(s.build, c).length > 0);
      if (!touched.length && !s.goal) {
        return { ok: true, buildRevision: s.buildRevision, delta: { added: [], removed: [] }, notice: "build already empty" };
      }
      return commit({ build: emptyBuild(), goal: undefined }, actor, "cleared the build and goal", touched, s.goal !== undefined, meta);
    },

    undo(historyId, actor) {
      const s = get();
      const entry = s.history.find((h) => h.id === historyId);
      if (!entry) return fail("NOTHING_TO_UNDO", `no history entry "${historyId}"`);
      const row = s.feed.find((f) => f.historyId === historyId);
      if (row?.undo === "none") return fail("NOTHING_TO_UNDO", "this action has already been undone");
      const guardOk =
        entry.guard.every((g) => sameIds(slotIds(s.build, g.category), g.expectPartIds)) &&
        (entry.expectGoal === undefined || sameGoal(s.goal, entry.expectGoal));
      if (!guardOk || row?.undo === "superseded") {
        set((st) => ({ feed: st.feed.map((f) => (f.historyId === historyId ? { ...f, undo: "superseded" } : f)) }));
        return fail("UNDO_SUPERSEDED", "the affected slot has changed since this action; undo is no longer possible", { historyId });
      }
      const r = runOps(entry.inverse);
      if (isResult(r)) return r;
      const touched = entry.guard.map((g) => g.category);
      return commit(r, actor, `undid: ${entry.label}`, touched, entry.expectGoal !== undefined, undefined, { undoOf: historyId });
    },

    undoLast(actor) {
      const s = get();
      const last = [...s.history].reverse().find((h) => s.feed.find((f) => f.historyId === h.id)?.undo === "available");
      if (!last) return fail("NOTHING_TO_UNDO", "nothing to undo");
      return get().undo(last.id, actor);
    },

    loadBuild(payload, actor, meta, revisionFloor) {
      const s = get();
      if (!s.catalog) return fail("NO_CATALOG", "catalog not loaded yet");
      if (!payload || payload.v !== 1 || !Array.isArray(payload.parts)) return fail("INVALID_INPUT", "unsupported build payload");
      const known: string[] = [];
      const dropped: string[] = [];
      for (const id of payload.parts) (s.catalog.byId.has(id) ? known : dropped).push(id);
      let build = emptyBuild();
      for (const id of known) {
        const p = s.catalog.byId.get(id)!;
        try {
          build = withPart(build, p);
        } catch {
          dropped.push(id); // second part for a single slot
        }
      }
      const touched = CATEGORIES.filter((c) => partsIn(s.build, c).length > 0 || partsIn(build, c).length > 0);
      const goalTouched = !sameGoal(s.goal, payload.goal);
      const res = commit(
        { build, goal: payload.goal },
        actor,
        `loaded a build with ${known.length - dropped.filter((d) => known.includes(d)).length} parts`,
        touched,
        goalTouched,
        meta,
        { revisionFloor },
      );
      if (!res.ok) return res;
      const notice = dropped.length ? `${dropped.length} part(s) were dropped: ${dropped.join(", ")}` : undefined;
      if (notice) get().logFeed({ actor, kind: "note", title: notice });
      return { ...res, dropped, notice };
    },

    addRender(r) {
      set((st) => ({ renders: [...st.renders.filter((x) => x.renderId !== r.renderId), r] }));
    },

    updateRender(renderId, patch) {
      set((st) => ({ renders: st.renders.map((r) => (r.renderId === renderId ? { ...r, ...patch } : r)) }));
    },

    removeRender(renderId) {
      set((st) => ({ renders: st.renders.filter((r) => r.renderId !== renderId) }));
    },

    logFeed(item) {
      const full: FeedItem = { id: newId("f"), at: now(), buildRevision: get().buildRevision, ...item };
      set((st) => ({ feed: [...st.feed, full] }));
      return full;
    },

    resetAll() {
      set({ build: emptyBuild(), goal: undefined, buildRevision: 0, renders: [], feed: [], history: [], conflicts: [] });
    },
  };
});

function summarizeDelta(delta: ValidationDelta, conflicts: Conflict[]): string {
  const e = conflicts.filter((c) => c.severity === "error").length;
  const w = conflicts.filter((c) => c.severity === "warning").length;
  const bits = [
    e === 0 && w === 0
      ? "Compatibility check passed."
      : `Compatibility check found ${[e ? `${e} error${e === 1 ? "" : "s"}` : "", w ? `${w} warning${w === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")}.`,
  ];
  const added = conflicts.filter((c) => delta.added.includes(c.code)).map((c) => c.explanation);
  if (added.length) bits.push(added.join(" "));
  if (delta.removed.length) bits.push(`Resolved ${delta.removed.length} previous compatibility issue${delta.removed.length === 1 ? "" : "s"}.`);
  return bits.join(" ");
}

// ---------- selectors (plain functions; usable with useStore(selector) or on getState()) ----------

export const selectActiveRender = (s: StoreState): RenderArtifact | undefined => [...s.renders].reverse().find((r) => r.status === "active");
export const selectTotalUSD = (s: StoreState): number => Math.round(Object.values(s.build.slots).flat().reduce((t, p) => t + (p?.priceUSD ?? 0), 0) * 100) / 100;
export const selectConflictCodes = (s: StoreState): RuleCode[] => s.conflicts.map((c) => c.code);

export { type Build, type Goal, type Conflict, type CatalogIndex } from "../engine";
export { hashBuild, sha256Hex } from "./hash";
export * from "./share";
