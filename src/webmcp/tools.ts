/**
 * The 14 shopper tools (DESIGN §4.1–4.3). Each execute(): parse input (zod, unknown fields rejected),
 * honour the AbortSignal, call engine/store, return the §4.4 envelope as a compact JSON string.
 * Write tools go through the stale-write guard (§4.5) before touching the store.
 */
import { z } from "zod";
import { CATEGORIES, RESOLUTIONS, WORKLOADS, type Category, type Part } from "../data/schema";
import {
  DIRECTIONS,
  LABEL,
  PRESERVES,
  RENDER_ANGLES,
  RENDER_FLAIR_MAX_LENGTH,
  RENDER_STYLES,
  RenderNeedsCaseError,
  alternatives,
  buildTotalUSD,
  countConflicts,
  estimateWattage,
  evaluateRule,
  fit,
  fitToBudget,
  normalizeRenderFlair,
  partsIn,
  performance,
  placeCandidate,
  psuHeadroomPct,
  rulesFor,
  single,
  utility,
  validate,
  type Build,
  type CatalogIndex,
  type Conflict,
  type Goal,
  type RenderAngle,
  type RenderStyle,
} from "../engine";
import {
  applyOps,
  encodeShare,
  goalSchema,
  hashBuild,
  newId,
  payloadFromBuild,
  selectActiveRender,
  useStore,
  type BuildOp,
  type RenderArtifact,
  type Result,
} from "../store";
import type { ToolDefinition } from "./adapter";
import { TOOL_DEFINITIONS, type ToolName } from "./descriptions";
import { fail, ok, type ErrorCode } from "./envelope";
import { checkRevision } from "./lastSeen";
import { partThumbnailUrl } from "../catalog/cardImages";
import { getRenderQuotaStatus } from "../ui/renderClient";

// ---------- shared helpers ----------

export const SEARCH_DEFAULT_LIMIT = 6;
/** Names are capped in list views (full name via get_part_details). */
export const NAME_MAX = 36;
export const SEARCH_MAX_LIMIT = 20;

/** ≤ 5 key specs per category, shown in search results and get_build_state. */
export function keySpecs(p: Part): Record<string, string | number | boolean> {
  switch (p.category) {
    case "cpu":
      return { socket: p.socket, cores: p.cores, threads: p.threads, tdpW: p.tdpW, hasIgpu: p.hasIgpu };
    case "motherboard":
      return { socket: p.socket, chipset: p.chipset, formFactor: p.formFactor, ddrGen: p.ddrGen, m2Slots: p.m2Slots };
    case "ram":
      return { ddrGen: p.ddrGen, speedMHz: p.speedMHz, sticks: p.sticks, capacityGB: p.sticks * p.capacityPerStickGB, hasRgb: p.hasRgb };
    case "gpu":
      return { vramGB: p.vramGB, lengthMm: p.lengthMm, tdpW: p.tdpW, recommendedPsuW: p.recommendedPsuW, noiseTier: p.noiseTier };
    case "cooler":
      return p.type === "air"
        ? { type: p.type, heightMm: p.heightMm ?? 0, tdpRatingW: p.tdpRatingW, noiseTier: p.noiseTier, hasRgb: p.hasRgb }
        : { type: p.type, radiatorMm: p.radiatorMm ?? 0, tdpRatingW: p.tdpRatingW, noiseTier: p.noiseTier, hasRgb: p.hasRgb };
    case "case":
      // Form-factor / radiator support is covered by `fit`; keep the clearance numbers agents reason about.
      return { volumeLiters: p.volumeLiters, maxGpuLengthMm: p.maxGpuLengthMm, maxCoolerHeightMm: p.maxCoolerHeightMm, color: p.color };
    case "psu":
      return { wattage: p.wattage, formFactor: p.formFactor, efficiency: p.efficiency, modular: p.modular, noiseTier: p.noiseTier };
    case "storage":
      return p.pcieGen ? { interface: p.interface, capacityGB: p.capacityGB, pcieGen: p.pcieGen } : { interface: p.interface, capacityGB: p.capacityGB };
  }
}

const shortName = (n: string) => (n.length > NAME_MAX ? n.slice(0, NAME_MAX - 1) + "…" : n);
const slim = (p: Part, specCount = 5) => ({
  id: p.id,
  name: shortName(p.name),
  priceUSD: p.priceUSD,
  verified: p.verified,
  specs: Object.fromEntries(Object.entries(keySpecs(p)).slice(0, specCount)),
});

const conflictRows = (cs: readonly Conflict[]) => cs.map((c) => ({ code: c.code, severity: c.severity, partIds: c.partIds, explanation: c.explanation }));

/** Filterable fields per category (exact match, or min<Field>/max<Field> for numbers). */
const FILTER_FIELDS: Record<Category, readonly string[]> = {
  cpu: ["socket", "generation", "cores", "threads", "boostClockMHz", "tdpW", "hasIgpu", "includesCooler"],
  motherboard: ["socket", "chipset", "formFactor", "ddrGen", "maxRamSpeedMHz", "ramSlots", "m2Slots", "sataPorts", "pcieGen"],
  ram: ["ddrGen", "speedMHz", "sticks", "capacityPerStickGB", "hasRgb", "capacityGB"],
  gpu: ["lengthMm", "slots", "tdpW", "pcieGen", "recommendedPsuW", "vramGB", "noiseTier"],
  cooler: ["type", "heightMm", "radiatorMm", "tdpRatingW", "noiseTier", "hasRgb", "socket"],
  case: ["maxGpuLengthMm", "maxCoolerHeightMm", "volumeLiters", "color", "hasWindow", "frontStyle", "noiseTier", "formFactor", "psuFormFactor", "radiatorMm"],
  psu: ["wattage", "formFactor", "efficiency", "modular", "noiseTier"],
  storage: ["interface", "capacityGB", "pcieGen"],
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Virtual/array-aware field access for filters. */
function fieldValue(p: Part, field: string): unknown {
  const rec = p as unknown as Record<string, unknown>;
  if (p.category === "ram" && field === "capacityGB") return p.sticks * p.capacityPerStickGB;
  if (p.category === "cooler" && field === "socket") return p.socketSupport;
  if (p.category === "case") {
    if (field === "formFactor") return p.formFactorSupport;
    if (field === "psuFormFactor") return p.psuFormFactor;
    if (field === "radiatorMm") return p.radiatorSupport;
  }
  return rec[field];
}

type FilterError = { key: string; message: string };

function compileFilters(category: Category, filters: Record<string, unknown>): { test: (p: Part) => boolean } | FilterError {
  const preds: ((p: Part) => boolean)[] = [];
  const allowed = FILTER_FIELDS[category];
  for (const [key, raw] of Object.entries(filters)) {
    const m = /^(min|max)([A-Z].*)$/.exec(key);
    if (m) {
      const field = lowerFirst(m[2]!);
      if (!allowed.includes(field)) return { key, message: `unknown filter "${key}" for ${category}; fields: ${allowed.join(", ")}` };
      if (typeof raw !== "number") return { key, message: `filter "${key}" must be a number` };
      const isMin = m[1] === "min";
      preds.push((p) => {
        const v = fieldValue(p, field);
        if (typeof v !== "number") return false;
        return isMin ? v >= raw : v <= raw;
      });
      continue;
    }
    if (!allowed.includes(key)) return { key, message: `unknown filter "${key}" for ${category}; fields: ${allowed.join(", ")}` };
    if (raw !== null && typeof raw === "object") return { key, message: `filter "${key}" must be a string, number or boolean` };
    preds.push((p) => {
      const v = fieldValue(p, key);
      if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase() === String(raw).toLowerCase());
      if (typeof v === "string" && typeof raw === "string") return v.toLowerCase() === raw.toLowerCase();
      return v === raw;
    });
  }
  return { test: (p) => preds.every((f) => f(p)) };
}

const isFilterError = (x: unknown): x is FilterError => typeof x === "object" && x !== null && "key" in x;

/** Maps a store Result failure to an envelope. */
function storeFail(r: Extract<Result, { ok: false }>): string {
  const map: Record<string, ErrorCode> = {
    UNKNOWN_PART: "UNKNOWN_PART",
    SLOT_OCCUPIED: "SLOT_OCCUPIED",
    INVALID_INPUT: "INVALID_INPUT",
    NO_CATALOG: "BACKEND_UNAVAILABLE",
  };
  return fail(map[r.code] ?? "INTERNAL", r.message, r.details);
}

function requireCatalog(): CatalogIndex | string {
  const c = useStore.getState().catalog;
  return c ?? fail("BACKEND_UNAVAILABLE", "catalog not loaded yet; try again in a moment");
}

function staleGuard(expectedRevision?: number): string | null {
  const s = useStore.getState();
  const chk = checkRevision(s.buildRevision, expectedRevision);
  if (chk.ok) return null;
  return fail(
    "STALE_REVISION",
    `build is at revision ${chk.current} but you last saw ${chk.expected} (${chk.source}); the human may have changed it. Nothing was changed - call get_build_state and re-plan.`,
    { expected: chk.expected, current: chk.current },
  );
}

const deltaSummary = (delta: { added: string[]; removed: string[] }, s = useStore.getState()) => {
  const c = countConflicts(s.conflicts);
  const bits = [`${c.errors} error${c.errors === 1 ? "" : "s"}, ${c.warnings} warning${c.warnings === 1 ? "" : "s"}`];
  if (delta.added.length) bits.push(`new: ${delta.added.join(", ")}`);
  if (delta.removed.length) bits.push(`cleared: ${delta.removed.join(", ")}`);
  return bits.join("; ");
};

// ---------- zod input schemas (strict: unknown fields → INVALID_INPUT) ----------

const partId = z.string().trim().min(1).max(80);
const revision = z.number().int().min(0).optional();

const inputs = {
  get_build_state: z.object({}).strict(),
  search_parts: z
    .object({
      category: z.enum(CATEGORIES),
      query: z.string().trim().max(80).optional(),
      minPrice: z.number().min(0).optional(),
      maxPrice: z.number().min(0).optional(),
      filters: z.record(z.string(), z.unknown()).optional(),
      compatibleWithCurrentBuild: z.boolean().optional(),
      sortBy: z.enum(["price", "performance", "name"]).optional(),
      limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).optional(),
      offset: z.number().int().min(0).optional(),
    })
    .strict(),
  get_part_details: z.object({ partId }).strict(),
  validate_build: z
    .object({
      hypothetical: z
        .array(z.object({ op: z.enum(["add", "replace", "remove"]), partId, replacesPartId: partId.optional() }).strict())
        .max(16)
        .optional(),
    })
    .strict(),
  explain_compatibility: z.object({ partId }).strict(),
  estimate_performance: z.object({ workload: z.enum(WORKLOADS), resolution: z.enum(RESOLUTIONS).optional() }).strict(),
  add_part: z.object({ partId, replace: z.boolean().optional(), replacesPartId: partId.optional(), expectedRevision: revision }).strict(),
  remove_part: z.object({ partId: partId.optional(), category: z.enum(CATEGORIES).optional(), expectedRevision: revision }).strict(),
  set_build_goal: goalSchema.extend({ expectedRevision: revision }).strict(),
  reset_build: z.object({ confirm: z.literal(true), expectedRevision: revision }).strict(),
  render_build: z
    .object({
      style: z.enum(RENDER_STYLES).optional(),
      angle: z.enum(RENDER_ANGLES).optional(),
      flair: z.string().trim().min(1).max(RENDER_FLAIR_MAX_LENGTH).regex(/^[^\u0000-\u001f\u007f]*$/, "flair must be a single line").optional(),
    })
    .strict(),
  suggest_alternatives: z
    .object({ category: z.enum(CATEGORIES), direction: z.enum(DIRECTIONS as [string, ...string[]]).optional(), count: z.number().int().min(1).max(6).optional(), currentPartId: partId.optional() })
    .strict(),
  fit_to_budget: z
    .object({ budgetUSD: z.number().min(1).max(100000), protect: z.array(z.enum(CATEGORIES)).max(8).optional(), preserve: z.enum(PRESERVES as [string, ...string[]]).optional() })
    .strict(),
  export_build: z.object({ format: z.enum(["markdown", "json", "url"]) }).strict(),
} as const;

type Inputs = { [K in keyof typeof inputs]: z.infer<(typeof inputs)[K]> };

// ---------- handlers ----------

type Ctx = { signal?: AbortSignal; skipFeed?: boolean };
type Handler<K extends ToolName> = (input: Inputs[K], ctx: Ctx) => Promise<string> | string;

const handlers: { [K in ToolName]: Handler<K> } = {
  async get_build_state() {
    const s = useStore.getState();
    const renderQuota = await getRenderQuotaStatus();
    const slots = Object.fromEntries(
      CATEGORIES.map((c) => {
        const ps = partsIn(s.build, c).map((p) => slim(p, 3)); // top-3 specs; full sheet via get_part_details
        return [c, ps.length === 0 ? null : c === "ram" || c === "storage" ? ps : ps[0]];
      }),
    );
    const active = selectActiveRender(s);
    const counts = countConflicts(s.conflicts);
    const filled = CATEGORIES.filter((c) => partsIn(s.build, c).length > 0).length;
    return ok(
      {
        slots,
        totalUSD: buildTotalUSD(s.build),
        estWatts: estimateWattage(s.build),
        psuHeadroomPct: psuHeadroomPct(s.build) ?? null,
        conflicts: conflictRows(s.conflicts),
        goal: s.goal ?? null,
        activeRender: active ? { renderId: active.renderId, forBuildRevision: active.forBuildRevision, imageUrl: active.imageUrl, style: active.style, angle: active.angle } : null,
        catalogVersion: s.catalogVersion,
        catalogSource: s.catalogSource,
        renderQuota,
      },
      { summary: `${filled}/8 slots filled, $${buildTotalUSD(s.build)}, ${counts.errors} errors, ${counts.warnings} warnings${s.goal ? `, goal ${s.goal.useCase} $${s.goal.budgetUSD}` : ", no goal"}` },
    );
  },

  search_parts(input) {
    const cat = requireCatalog();
    if (typeof cat === "string") return cat;
    const s = useStore.getState();
    const buildEmpty = CATEGORIES.every((c) => partsIn(s.build, c).length === 0);
    const onlyCompatible = input.compatibleWithCurrentBuild ?? !buildEmpty;
    const limit = input.limit ?? SEARCH_DEFAULT_LIMIT;
    const offset = input.offset ?? 0;
    const compiled = compileFilters(input.category, input.filters ?? {});
    if (isFilterError(compiled)) return fail("INVALID_INPUT", compiled.message, { filter: compiled.key });
    const q = input.query?.toLowerCase();

    let rows = cat.byCategory[input.category]
      .filter((p) => p.status === "published")
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q) || p.id.includes(q))
      .filter((p) => input.minPrice === undefined || p.priceUSD >= input.minPrice)
      .filter((p) => input.maxPrice === undefined || p.priceUSD <= input.maxPrice)
      .filter((p) => compiled.test(p))
      .map((p) => ({ p, f: fit(p, s.build, s.goal) }));
    const hidden = onlyCompatible ? rows.filter((r) => r.f.fit === "incompatible").length : 0;
    if (onlyCompatible) rows = rows.filter((r) => r.f.fit !== "incompatible");

    const sortBy = input.sortBy ?? "price";
    rows.sort((a, b) => {
      let r = 0;
      if (sortBy === "price") r = a.p.priceUSD - b.p.priceUSD;
      else if (sortBy === "performance") r = utility(b.p, s.goal) - utility(a.p, s.goal);
      else r = a.p.name.localeCompare(b.p.name);
      if (r === 0 && a.p.verified !== b.p.verified) r = a.p.verified ? -1 : 1;
      return r || a.p.id.localeCompare(b.p.id);
    });

    // `pending` (rule codes that need an empty slot) is omitted when empty to keep pages small.
    const page = rows.slice(offset, offset + limit).map(({ p, f }) => ({ ...slim(p), fit: f.fit, ...(f.pending.length ? { pending: f.pending } : {}), ...(f.preexisting.length ? { preexisting: f.preexisting } : {}) }));
    return ok(
      { parts: page, total: rows.length, limit, offset, filtered: onlyCompatible, ...(hidden ? { hidden } : {}) },
      { summary: `${page.length} of ${rows.length} ${LABEL[input.category]} parts${hidden ? ` (${hidden} incompatible hidden)` : ""}` },
    );
  },

  get_part_details(input) {
    const cat = requireCatalog();
    if (typeof cat === "string") return cat;
    const p = cat.byId.get(input.partId);
    if (!p) return fail("UNKNOWN_PART", `unknown part id "${input.partId}"`, { partId: input.partId });
    const s = useStore.getState();
    const { sources, addedBy, status, priceUpdatedAt, updatedAt, ...spec } = p;
    void addedBy;
    void status;
    void updatedAt;
    const sourceUrl = p.verified ? (sources[0]?.url ?? null) : null;
    return ok(
      { ...spec, imageUrl: partThumbnailUrl(p), sourceUrl, priceUpdatedAt, inBuild: partsIn(s.build, p.category).some((x) => x.id === p.id) },
      { summary: `${p.name} (${p.id}), $${p.priceUSD}, ${p.verified ? "verified" : "unverified"}` },
    );
  },

  validate_build(input) {
    const cat = requireCatalog();
    if (typeof cat === "string") return cat;
    const s = useStore.getState();
    let build: Build = s.build;
    let goal: Goal | undefined = s.goal;
    const hyp = input.hypothetical ?? [];
    if (hyp.length) {
      const ops: BuildOp[] = hyp.map((h) =>
        h.op === "remove"
          ? { op: "remove", partId: h.partId }
          : { op: "add", partId: h.partId, replace: h.op === "replace", replacesPartId: h.replacesPartId },
      );
      try {
        ({ build, goal } = applyOps(cat, build, goal, ops));
      } catch (e) {
        const err = e as { code?: string; message: string; details?: Record<string, unknown> };
        const code: ErrorCode = err.code === "SLOT_OCCUPIED" ? "SLOT_OCCUPIED" : err.code === "UNKNOWN_PART" ? "UNKNOWN_PART" : "INVALID_INPUT";
        return fail(code, `hypothetical op failed: ${err.message}`, err.details);
      }
    }
    const conflicts = validate(build, goal);
    const counts = countConflicts(conflicts);
    const slots = Object.fromEntries(CATEGORIES.map((c) => [c, partsIn(build, c).map((p) => p.id)]));
    return ok(
      {
        hypothetical: hyp.length > 0,
        appliedOps: hyp.length,
        slots,
        totalUSD: buildTotalUSD(build),
        estWatts: estimateWattage(build),
        psuHeadroomPct: psuHeadroomPct(build) ?? null,
        conflicts: conflictRows(conflicts),
        validation: counts,
      },
      { summary: `${hyp.length ? `with ${hyp.length} hypothetical op(s): ` : ""}${counts.errors} errors, ${counts.warnings} warnings, ${counts.info} info` },
    );
  },

  explain_compatibility(input) {
    const cat = requireCatalog();
    if (typeof cat === "string") return cat;
    const p = cat.byId.get(input.partId);
    if (!p) return fail("UNKNOWN_PART", `unknown part id "${input.partId}"`, { partId: input.partId });
    const s = useStore.getState();
    const hypothetical = placeCandidate(p, s.build);
    const rules = rulesFor(p.category).map((r) => evaluateRule(r, { build: hypothetical, goal: s.goal }));
    const overall = fit(p, s.build, s.goal);
    const rows = rules.map((r) => ({ code: r.code, severity: r.severity, result: r.result, reason: r.reason }));
    const fails = rows.filter((r) => r.result === "fail").length;
    return ok(
      { partId: p.id, name: p.name, verified: p.verified, fit: overall.fit, pending: overall.pending, preexisting: overall.preexisting, rules: rows },
      { summary: `${p.name} is ${overall.fit} with the current build (${fails} failing rule${fails === 1 ? "" : "s"}, ${overall.pending.length} unchecked)` },
    );
  },

  estimate_performance(input) {
    const s = useStore.getState();
    const r = performance(s.build, input.workload, input.resolution);
    return ok(r, {
      summary: `editorial tier estimate for ${input.workload}${input.resolution ? ` @ ${input.resolution}` : ""}: ${r.overallTier !== undefined ? `overall tier ${r.overallTier}/10` : "no CPU/GPU yet"}; ${r.balanceNote}`,
    });
  },

  add_part(input, ctx) {
    const stale = staleGuard(input.expectedRevision);
    if (stale) return stale;
    const r = useStore.getState().addPart(input.partId, { replace: input.replace, replacesPartId: input.replacesPartId }, "agent", { toolName: "add_part" });
    if (!r.ok) return storeFail(r);
    ctx.skipFeed = true;
    const p = useStore.getState().catalog!.byId.get(input.partId)!;
    return ok({ partId: p.id, name: p.name, category: p.category, verified: p.verified }, { summary: `${LABEL[p.category]} set to ${p.name}; ${deltaSummary(r.delta)}`, delta: r.delta });
  },

  remove_part(input, ctx) {
    if (!input.partId === !input.category) return fail("INVALID_INPUT", "provide exactly one of partId or category");
    const stale = staleGuard(input.expectedRevision);
    if (stale) return stale;
    const r = useStore.getState().removePart({ partId: input.partId, category: input.category }, "agent", { toolName: "remove_part" });
    if (!r.ok) return storeFail(r);
    ctx.skipFeed = true;
    const what = input.partId ?? `all ${LABEL[input.category!]}`;
    return ok({ removed: what }, { summary: `removed ${what}; ${deltaSummary(r.delta)}`, delta: r.delta });
  },

  set_build_goal(input, ctx) {
    const stale = staleGuard(input.expectedRevision);
    if (stale) return stale;
    const { expectedRevision, ...goal } = input;
    void expectedRevision;
    const r = useStore.getState().setGoal(goal as Goal, "agent", { toolName: "set_build_goal" });
    if (!r.ok) return storeFail(r);
    ctx.skipFeed = true;
    return ok({ goal }, { summary: `goal set: ${goal.useCase}, $${goal.budgetUSD}; ${deltaSummary(r.delta)}`, delta: r.delta });
  },

  reset_build(input, ctx) {
    const stale = staleGuard(input.expectedRevision);
    if (stale) return stale;
    const r = useStore.getState().resetBuild("agent", { toolName: "reset_build" });
    if (!r.ok) return storeFail(r);
    ctx.skipFeed = true;
    return ok({ cleared: true }, { summary: "build and goal cleared", delta: r.delta });
  },

  async render_build(input, ctx) {
    const s = useStore.getState();
    const style: RenderStyle = input.style ?? "photoreal";
    const angle: RenderAngle = input.angle ?? "three-quarter";
    const flair = normalizeRenderFlair(input.flair);
    if (!single(s.build, "case")) return fail("RENDER_NEEDS_CASE", "add a case first; the render is built from the case and what is inside it");
    let buildHash: string;
    try {
      buildHash = await hashBuild(s.build, s.goal, style, angle, flair);
    } catch (e) {
      if (e instanceof RenderNeedsCaseError) return fail("RENDER_NEEDS_CASE", e.message);
      throw e;
    }
    if (ctx.signal?.aborted) return fail("CANCELLED", "render cancelled before it started");

    const existing = s.renders.find((r) => r.buildHash === buildHash && r.status === "active");
    if (existing) {
      return ok({ ...artifactOut(existing), cached: true }, { summary: "this exact build was already rendered; returning the active render" });
    }

    const renderId = newId("r");
    const artifact: RenderArtifact = {
      renderId,
      forBuildRevision: s.buildRevision,
      buildHash,
      imageUrl: "",
      status: "pending",
      style,
      angle,
      flair,
      createdAt: new Date().toISOString(),
    };
    s.addRender(artifact);
    const payload = { v: 1, partIds: payloadFromBuild(s.build).parts, goal: s.goal, style, angle, ...(flair ? { flair } : {}) };

    let res: Response;
    try {
      res = await fetch("/api/render", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctx.signal,
      });
    } catch (e) {
      const cancelled = ctx.signal?.aborted || (e instanceof Error && e.name === "AbortError");
      useStore.getState().updateRender(renderId, { status: "failed", error: cancelled ? "cancelled" : "network error" });
      return cancelled ? fail("CANCELLED", "render cancelled") : fail("RENDER_UNAVAILABLE", "render backend unreachable; the page shows the schematic instead");
    }

    if (!res.ok) {
      let body: { code?: string; message?: string; retryAfterSec?: number; details?: Record<string, unknown>; error?: { code?: string; message?: string; details?: Record<string, unknown> } } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        /* non-JSON error */
      }
      const server = body.error ?? body;
      const serverCode = server.code;
      const renderCodes: readonly ErrorCode[] = [
        "VERIFICATION_REQUIRED",
        "RENDER_RATE_LIMITED",
        "RENDER_USER_DAILY_LIMIT",
        "RENDER_GLOBAL_DAILY_LIMIT",
        "RENDER_IN_PROGRESS",
        "RENDER_FAILED",
        "RENDER_UNAVAILABLE",
      ];
      const code: ErrorCode =
        typeof serverCode === "string" && renderCodes.includes(serverCode as ErrorCode)
          ? (serverCode as ErrorCode)
          : res.status === 403
            ? "VERIFICATION_REQUIRED"
            : res.status === 429
              ? "RENDER_RATE_LIMITED"
              : res.status === 504
                ? "RENDER_FAILED"
                : "RENDER_UNAVAILABLE";
      const message =
        server.message ??
        (code === "VERIFICATION_REQUIRED"
          ? "the human must click 'Verify to render' on the page once, then retry"
          : code === "RENDER_RATE_LIMITED" || code === "RENDER_USER_DAILY_LIMIT" || code === "RENDER_GLOBAL_DAILY_LIMIT"
            ? "render limit reached; retry later"
            : code === "RENDER_IN_PROGRESS"
              ? "this exact build is already being rendered; retry shortly"
            : code === "RENDER_FAILED"
              ? "the image provider did not finish in time"
              : "rendering is unavailable right now");
      useStore.getState().updateRender(renderId, { status: "failed", error: code });
      const details = server.details ?? (body.retryAfterSec !== undefined ? { retryAfterSec: body.retryAfterSec } : undefined);
      return fail(code, message, details);
    }

    let data: { imageUrl: string; buildHash?: string; cached?: boolean };
    try {
      data = (await res.json()) as typeof data;
      if (typeof data.imageUrl !== "string") throw new Error("bad body");
    } catch {
      useStore.getState().updateRender(renderId, { status: "failed", error: "bad response" });
      return fail("RENDER_FAILED", "render backend returned an unexpected response");
    }
    // Resolve: active only if the build hash still matches what the page shows now.
    const now = useStore.getState();
    let stillMatches = false;
    try {
      stillMatches = (await hashBuild(now.build, now.goal, style, angle, flair)) === buildHash;
    } catch {
      stillMatches = false;
    }
    const status: RenderArtifact["status"] = stillMatches ? "active" : "superseded";
    if (stillMatches) {
      // Only one active render per style/angle: supersede earlier ones for the same view.
      for (const r of now.renders) if (r.status === "active" && r.renderId !== renderId) now.updateRender(r.renderId, { status: "superseded" });
    }
    now.updateRender(renderId, { status, imageUrl: data.imageUrl, cached: data.cached ?? false });
    const final = useStore.getState().renders.find((r) => r.renderId === renderId)!;
    return ok(artifactOut(final), {
      summary: stillMatches
        ? `render ready${final.cached ? " (cached)" : ""}; shown on the page`
        : `render finished but the build changed meanwhile (rev ${final.forBuildRevision} → ${now.buildRevision}); stored as superseded`,
    });
  },

  suggest_alternatives(input) {
    const cat = requireCatalog();
    if (typeof cat === "string") return cat;
    const s = useStore.getState();
    const r = alternatives(input.category, s.build, cat, {
      direction: input.direction as (typeof DIRECTIONS)[number] | undefined,
      count: input.count,
      goal: s.goal,
      currentPartId: input.currentPartId,
    });
    if (!r.ok) return fail("DIRECTION_NOT_APPLICABLE", r.message, { direction: r.direction, applicable: r.applicable });
    const candidates = r.candidates.map((a) => ({
      partId: a.part.id,
      name: shortName(a.part.name),
      priceUSD: a.part.priceUSD,
      verified: a.verified,
      priceDelta: a.priceDelta,
      utilityDelta: a.utilityDelta,
      specDelta: Object.fromEntries(Object.entries(a.specDelta).slice(0, 4).map(([k, v]) => [k, `${v.from ?? "-"}→${v.to ?? "-"}`])),
      validation: a.validation,
      tradeoff: a.tradeoff,
    }));
    return ok(
      { category: input.category, current: r.current?.id ?? null, direction: r.direction ?? null, candidates },
      { summary: `${candidates.length} ${input.direction ?? "comparable"} alternative(s) for ${LABEL[input.category]}${r.current ? ` (currently ${r.current.id})` : " (slot empty)"}` },
    );
  },

  fit_to_budget(input) {
    const cat = requireCatalog();
    if (typeof cat === "string") return cat;
    const s = useStore.getState();
    const r = fitToBudget(s.build, cat, { budgetUSD: input.budgetUSD, protect: input.protect, preserve: input.preserve as (typeof PRESERVES)[number] | undefined, goal: s.goal });
    if (!r.ok) return fail("BUDGET_INFEASIBLE", r.message, { cheapestTotal: r.cheapestTotal, blockedBy: r.blockedBy });
    const proposal = {
      proposalId: newId("p"),
      forBuildRevision: s.buildRevision,
      budgetUSD: input.budgetUSD,
      ops: r.ops,
      totalUSD: r.totalUSD,
      savings: Math.round((buildTotalUSD(s.build) - r.totalUSD) * 100) / 100,
      validation: r.validation.map((c) => ({ code: c.code, severity: c.severity })),
      preserve: r.preserve,
      loss: r.loss,
      swaps: r.swaps,
    };
    return ok(proposal, {
      summary: r.ops.length
        ? `proposal: ${r.swaps} swap(s) → $${r.totalUSD} (≤ $${input.budgetUSD}), ${r.preserve} loss ${r.loss}; not applied`
        : `already within $${input.budgetUSD} at $${r.totalUSD}; nothing to change`,
    });
  },

  async export_build(input, ctx) {
    const s = useStore.getState();
    const payload = payloadFromBuild(s.build, s.goal);
    if (input.format === "json") return ok(payload, { summary: `${payload.parts.length} part id(s)${s.goal ? " + goal" : ""} as JSON` });
    if (input.format === "markdown") {
      const counts = countConflicts(s.conflicts);
      const lines: string[] = ["# RigBuilder build", ""];
      for (const c of CATEGORIES) {
        const ps = partsIn(s.build, c);
        if (!ps.length) lines.push(`- **${LABEL[c]}**: —`);
        for (const p of ps) lines.push(`- **${LABEL[c]}**: ${p.name} (${p.id}) — $${p.priceUSD}${p.verified ? " ✓" : ""}`);
      }
      lines.push("", `**Total:** $${buildTotalUSD(s.build)} · est. ${estimateWattage(s.build)} W`);
      if (s.goal) lines.push(`**Goal:** ${s.goal.useCase}, $${s.goal.budgetUSD}`);
      lines.push(`**Validation:** ${counts.errors} errors, ${counts.warnings} warnings`);
      for (const c of s.conflicts) lines.push(`  - ${c.severity.toUpperCase()} ${c.code}: ${c.explanation}`);
      return ok({ markdown: lines.join("\n") }, { summary: "markdown parts list" });
    }
    // url
    let fragment: string;
    try {
      fragment = `#b=${encodeShare(payload)}`;
    } catch (e) {
      return fail("INVALID_INPUT", e instanceof Error ? e.message : "share payload too large");
    }
    const origin = typeof location !== "undefined" ? location.origin : "";
    let id: string | null = null;
    try {
      const res = await fetch("/api/builds", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctx.signal,
      });
      if (res.ok) {
        const body = (await res.json()) as { id?: string };
        if (typeof body.id === "string" && /^[a-z0-9-]{4,64}$/i.test(body.id)) id = body.id;
      }
    } catch (e) {
      if (ctx.signal?.aborted || (e instanceof Error && e.name === "AbortError")) return fail("CANCELLED", "export cancelled");
    }
    const url = id ? `${origin}/b/${id}${fragment}` : `${origin}/${fragment}`;
    const transport = id ? "short+fragment" : "fragment";
    return ok({ url, transport, id }, { summary: `share link (${transport}); the fragment alone reloads the build` });
  },
};

const artifactOut = (r: RenderArtifact) => ({
  renderId: r.renderId,
  forBuildRevision: r.forBuildRevision,
  buildHash: r.buildHash,
  imageUrl: r.imageUrl,
  cached: r.cached ?? false,
  status: r.status,
  style: r.style,
  angle: r.angle,
  ...(r.flair ? { flair: r.flair } : {}),
});

// ---------- tool factory ----------

type FeedEnvelope = {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  error?: { code: string };
};

/**
 * Activity copy is written for the person watching the agent, not for the agent
 * calling the tool. Internal tool names and argument payloads remain available in
 * the store for diagnostics, but never have to become the UI label.
 */
function agentActivityTitle(name: ToolName, rawInput: unknown, env: FeedEnvelope): string | null {
  // State reads are synchronization chatter. They do not represent meaningful
  // progress and would otherwise dominate the activity feed.
  if (name === "get_build_state") return null;

  const input = rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};
  const done = (complete: string, attempt: string) => (env.ok ? complete : `Tried to ${attempt}`);
  const category = CATEGORIES.includes(input.category as Category) ? LABEL[input.category as Category] : "part";
  const partName = typeof env.data?.name === "string" ? env.data.name : env.ok ? "a part" : "the requested part";

  switch (name) {
    case "search_parts":
      return done(`Searched the catalog for ${category} options`, `search the catalog for ${category} options`);
    case "get_part_details":
      return done(`Reviewed ${partName}`, `review ${partName}`);
    case "validate_build": {
      const changes = Array.isArray(input.hypothetical) ? input.hypothetical.length : 0;
      return changes
        ? done(`Tested ${changes} possible change${changes === 1 ? "" : "s"}`, `test ${changes} possible change${changes === 1 ? "" : "s"}`)
        : done("Checked the build for compatibility", "check the build for compatibility");
    }
    case "explain_compatibility":
      return done(`Checked whether ${partName} fits the build`, `check whether ${partName} fits the build`);
    case "estimate_performance": {
      const workload = typeof input.workload === "string" ? input.workload.replaceAll("-", " ") : "build";
      const resolution = typeof input.resolution === "string" ? ` at ${input.resolution.toUpperCase()}` : "";
      return done(`Estimated ${workload} performance${resolution}`, `estimate ${workload} performance${resolution}`);
    }
    case "add_part":
      return done(`Added ${partName} to the build`, `add ${partName} to the build`);
    case "remove_part":
      return done(`Removed ${partName} from the build`, `remove ${partName} from the build`);
    case "set_build_goal":
      return done("Updated the build goal", "update the build goal");
    case "reset_build":
      return done("Cleared the build", "clear the build");
    case "render_build": {
      const style = typeof input.style === "string" ? input.style : "photoreal";
      return done(`Created a ${style} build preview`, `create a ${style} build preview`);
    }
    case "suggest_alternatives": {
      const direction = typeof input.direction === "string" ? `${input.direction} ` : "";
      return done(`Compared ${direction}${category} options`, `compare ${direction}${category} options`);
    }
    case "fit_to_budget": {
      const budget = typeof input.budgetUSD === "number" ? ` within $${input.budgetUSD.toLocaleString("en-US")}` : " to the budget";
      return done(`Planned a build${budget}`, `plan a build${budget}`);
    }
    case "export_build":
      return input.format === "url"
        ? done("Created a share link", "create a share link")
        : done(`Exported the build as ${String(input.format ?? "a file")}`, `export the build as ${String(input.format ?? "a file")}`);
  }
  return done("Worked on the build", "work on the build");
}

function agentActivityDetail(name: ToolName, rawInput: unknown, env: FeedEnvelope): string {
  if (!env.ok) {
    const friendlyFailure: Partial<Record<string, string>> = {
      UNKNOWN_PART: "That part could not be found in the catalog.",
      SLOT_OCCUPIED: "That slot already has a part, so nothing was changed.",
      INVALID_INPUT: "The requested action could not be completed with those details.",
      STALE_REVISION: "The build changed before the action finished, so nothing was changed.",
      DIRECTION_NOT_APPLICABLE: "That comparison is not available for this part category.",
      BUDGET_INFEASIBLE: "No compatible set of changes could meet that budget.",
      RENDER_NEEDS_CASE: "A case needs to be selected before a preview can be created.",
      CANCELLED: "The action was cancelled.",
    };
    return friendlyFailure[env.error?.code ?? ""] ?? `Could not complete this: ${env.summary}`;
  }
  const input = rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};
  const data = env.data ?? {};

  if (name === "validate_build") {
    const validation = data.validation && typeof data.validation === "object" ? (data.validation as Record<string, unknown>) : {};
    const errors = typeof validation.errors === "number" ? validation.errors : 0;
    const warnings = typeof validation.warnings === "number" ? validation.warnings : 0;
    const conflicts = Array.isArray(data.conflicts) ? data.conflicts as Array<Record<string, unknown>> : [];
    const explanations = conflicts.map((c) => c.explanation).filter((x): x is string => typeof x === "string");
    if (errors === 0 && warnings === 0) return "No compatibility issues found.";
    const counts = [errors ? `${errors} error${errors === 1 ? "" : "s"}` : "", warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
    return `Found ${counts}.${explanations.length ? ` ${explanations.join(" ")}` : ""}`;
  }
  if (name === "get_part_details") {
    const price = typeof data.priceUSD === "number" ? `$${data.priceUSD.toLocaleString("en-US")}` : null;
    const verification = data.verified === true ? "Specs are verified." : data.verified === false ? "Specs are not yet verified." : null;
    return [price, verification].filter(Boolean).join(" ") || env.summary;
  }
  if (name === "suggest_alternatives") {
    const count = Array.isArray(data.candidates) ? data.candidates.length : 0;
    const direction = typeof input.direction === "string" ? input.direction : "comparable";
    return `Found ${count} ${direction} option${count === 1 ? "" : "s"}.`;
  }
  if (name === "fit_to_budget") {
    const swaps = Array.isArray(data.ops) ? data.ops.length : 0;
    const total = typeof data.totalUSD === "number" ? `$${data.totalUSD.toLocaleString("en-US")}` : null;
    return swaps
      ? `Found a plan with ${swaps} swap${swaps === 1 ? "" : "s"}${total ? `, bringing the total to ${total}` : ""}.`
      : `The build is already within budget${total ? ` at ${total}` : ""}.`;
  }
  if (name === "export_build") return input.format === "url" ? "The build is ready to share." : `The ${String(input.format ?? "export")} file is ready.`;
  return env.summary;
}

/** Executes tool `name` with raw input — the single entry point used by registration and tests. */
export async function executeShopperTool(name: ToolName, rawInput: unknown, signal?: AbortSignal): Promise<string> {
  const ctx: Ctx = { signal };
  let text: string;
  let errorForFeed: string | undefined;
  try {
    if (signal?.aborted) {
      text = fail("CANCELLED", "call was cancelled");
    } else {
      const parsed = (inputs[name] as z.ZodType).safeParse(rawInput ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).slice(0, 5);
        text = fail("INVALID_INPUT", `invalid input: ${issues.join("; ")}`, { issues });
      } else {
        text = await (handlers[name] as Handler<ToolName>)(parsed.data as never, ctx);
      }
    }
  } catch (e) {
    if (signal?.aborted || (e instanceof Error && e.name === "AbortError")) text = fail("CANCELLED", "call was cancelled");
    else {
      console.error(`[webmcp] ${name} failed`, e);
      text = fail("INTERNAL", e instanceof Error ? e.message : "unexpected error");
    }
  }
  if (!ctx.skipFeed) {
    try {
      const env = JSON.parse(text) as FeedEnvelope;
      if (!env.ok) errorForFeed = env.error?.code;
      const title = agentActivityTitle(name, rawInput, env);
      if (!title) return text;
      useStore.getState().logFeed({
        actor: "agent",
        kind: "tool",
        toolName: name,
        title: `🤖 ${title}`,
        resultSummary: agentActivityDetail(name, rawInput, env),
        error: errorForFeed,
        undo: "none",
      });
    } catch {
      /* never let feed logging break a tool */
    }
  }
  return text;
}

/** Builds the 14 adapter-level tool definitions from descriptions.ts + handlers. */
export function shopperToolDefinitions(): ToolDefinition[] {
  return TOOL_DEFINITIONS.map((d) => ({
    name: d.name,
    description: d.description,
    inputSchema: d.inputSchema,
    annotations: { readOnlyHint: d.readOnly },
    execute: (input, { signal }) => executeShopperTool(d.name, input, signal),
  }));
}
