/**
 * One source of truth for the 14 shopper tools: names, descriptions, parameter descriptions and JSON input
 * schemas (DESIGN §4.1–4.3, §4.6). Feeds registration, the chip popover and the size test.
 * The README table is a hand-maintained user-facing summary, not generated from this module.
 *
 * Budgets: description ≤ 500 chars, parameter description ≤ 150 chars. Shared context (categories, id format)
 * lives only in get_build_state + search_parts.
 */
import type { InputSchema } from "@mcp-b/webmcp-types";
import { CATEGORIES, RESOLUTIONS, WORKLOADS } from "../data/schema";
import { DIRECTIONS, PRESERVES, RENDER_ANGLES, RENDER_FLAIR_MAX_LENGTH, RENDER_STYLES } from "../engine";

export const TOOL_NAMES = [
  "get_build_state",
  "search_parts",
  "get_part_details",
  "validate_build",
  "explain_compatibility",
  "estimate_performance",
  "add_part",
  "remove_part",
  "set_build_goal",
  "reset_build",
  "render_build",
  "suggest_alternatives",
  "fit_to_budget",
  "export_build",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const WRITE_TOOLS: readonly ToolName[] = ["add_part", "remove_part", "set_build_goal", "reset_build"];

/** §4.5 (5) — appended to every build/goal write description. */
export const STALE_NUDGE = "If the human may have changed the build, call get_build_state first; on STALE_REVISION, re-read and re-plan.";

export interface ToolDescriptor {
  name: ToolName;
  description: string;
  inputSchema: InputSchema & { type: "object"; properties: Record<string, Record<string, unknown>>; required?: string[] };
  readOnly: boolean;
}

const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const num = (description: string, extra: Record<string, unknown> = {}) => ({ type: "number", description, ...extra });
const int = (description: string, extra: Record<string, unknown> = {}) => ({ type: "integer", description, ...extra });
const bool = (description: string) => ({ type: "boolean", description });
const enm = (values: readonly (string | number)[], description: string) => ({ type: typeof values[0] === "number" ? "integer" : "string", enum: [...values], description });

const expectedRevision = int("Optional. buildRevision you last saw; the write fails with STALE_REVISION if the build changed since. Defaults to the last revision returned to you.", { minimum: 0 });

const obj = (properties: Record<string, Record<string, unknown>>, required?: string[]): ToolDescriptor["inputSchema"] => ({
  type: "object",
  properties,
  ...(required?.length ? { required } : {}),
  additionalProperties: false,
});

export const TOOL_DEFINITIONS: readonly ToolDescriptor[] = [
  {
    name: "get_build_state",
    readOnly: true,
    description:
      "Full state of the PC build on this page: each slot (cpu, motherboard, ram, gpu, cooler, case, psu, storage; ram and storage may hold several) with part id, name, price, verified flag and key specs; total, estimated watts, PSU headroom, every compatibility conflict, the build goal, active render and catalogVersion. Part ids look like cpu-r7-9800x3d. The human can edit the build at any time; call this to re-sync. Every response also carries buildRevision and a digest.",
    inputSchema: obj({}),
  },
  {
    name: "search_parts",
    readOnly: true,
    description:
      "Search the catalog for one category (cpu, motherboard, ram, gpu, cooler, case, psu, storage). Returns parts with id (e.g. gpu-rtx-5070ti), price, verified and up to 5 key specs plus fit against the current build: compatible, conditional (rules that need an empty slot are listed in pending) or incompatible. By default incompatible parts are hidden once the build is non-empty. Paginated: total, limit, offset.",
    inputSchema: obj(
      {
        category: enm(CATEGORIES, "Part category to search."),
        query: str("Optional free-text match on name or brand (case-insensitive substring).", { maxLength: 80 }),
        minPrice: num("Optional minimum price in USD.", { minimum: 0 }),
        maxPrice: num("Optional maximum price in USD.", { minimum: 0 }),
        filters: {
          type: "object",
          description: "Optional typed spec filters, e.g. {socket:'AM5'}, {ddrGen:5}, {formFactor:'ITX'}, {minVramGB:16}, {maxLengthMm:300}, {type:'aio'}, {minWattage:750}.",
          additionalProperties: true,
        },
        compatibleWithCurrentBuild: bool("Default true when the build is non-empty: hide incompatible parts. Set false to see everything with fit reasons."),
        sortBy: enm(["price", "performance", "name"], "Sort order; default price ascending. performance = utility for the goal workload, descending."),
        limit: int("Results per page, default 6, max 20.", { minimum: 1, maximum: 20 }),
        offset: int("Pagination offset, default 0.", { minimum: 0 }),
      },
      ["category"],
    ),
  },
  {
    name: "get_part_details",
    readOnly: true,
    description:
      "Full spec sheet for one part id: every stored field for its category (sizes in mm, power in W, clocks in MHz, capacity in GB), performance tiers 1-10 for CPU/GPU, noise tier, verified flag and source URL when verified, same-origin thumbnail URL, and whether it is in the current build.",
    inputSchema: obj({ partId: str("Part id, e.g. cpu-r7-9800x3d.", { maxLength: 80 }) }, ["partId"]),
  },
  {
    name: "validate_build",
    readOnly: true,
    description:
      "Run the compatibility solver on the current build, or on a copy with hypothetical ops applied in order (nothing is mutated). Returns every conflict with code, severity (error/warning/info), partIds and a one-line explanation, plus estimated watts and PSU headroom. Use it to test a plan before writing. An add on an occupied single slot fails with SLOT_OCCUPIED unless the op is replace.",
    inputSchema: obj({
      hypothetical: {
        type: "array",
        description: "Optional ops to apply to a copy first, in order.",
        maxItems: 16,
        items: {
          type: "object",
          properties: {
            op: enm(["add", "replace", "remove"], "add = place in an empty slot; replace = swap the slot (or replacesPartId); remove = take out."),
            partId: str("Part id the op refers to.", { maxLength: 80 }),
            replacesPartId: str("For replace in ram/storage: the specific part to swap out.", { maxLength: 80 }),
          },
          required: ["op", "partId"],
          additionalProperties: false,
        },
      },
    }),
  },
  {
    name: "explain_compatibility",
    readOnly: true,
    description:
      "Explain how one catalog part would fit the current build, rule by rule: each relevant rule reports pass, fail, not_applicable or unknown with a reason such as 'GPU is 358 mm, case max 330 mm' or 'no case selected yet - length unchecked'. Also returns the overall fit (compatible / conditional / incompatible) and the pending rule codes. Read-only; the part is not added.",
    inputSchema: obj({ partId: str("Part id to evaluate against the current build.", { maxLength: 80 }) }, ["partId"]),
  },
  {
    name: "estimate_performance",
    readOnly: true,
    description:
      "Editorial performance estimate for the current build and a workload: CPU and GPU tiers (1-10), the bottleneck (lowest tier), overall tier, a balance note and PSU load (estimated watts, PSU wattage, headroom %). Tiers are curated review consensus, not benchmarks. Resolution applies to gaming only (default 1440p).",
    inputSchema: obj(
      {
        workload: enm(WORKLOADS, "Workload to estimate for."),
        resolution: enm(RESOLUTIONS, "Gaming resolution; ignored for other workloads. Default 1440p."),
      },
      ["workload"],
    ),
  },
  {
    name: "add_part",
    readOnly: false,
    description:
      "Add a catalog part to the build by id. Single-slot categories need replace: true when occupied, else SLOT_OCCUPIED. ram and storage hold several parts: pass replacesPartId to swap a specific one, otherwise the part is appended. Returns the new buildRevision, digest and validation delta (conflict codes added/removed). The human sees the change immediately and can undo it. " +
      STALE_NUDGE,
    inputSchema: obj(
      {
        partId: str("Part id to add, e.g. gpu-rtx-5070ti.", { maxLength: 80 }),
        replace: bool("Single-slot categories: replace the part currently in the slot."),
        replacesPartId: str("ram/storage: id of the part in the build to swap out.", { maxLength: 80 }),
        expectedRevision,
      },
      ["partId"],
    ),
  },
  {
    name: "remove_part",
    readOnly: false,
    description:
      "Remove from the build either one part by partId, or an entire category (for ram/storage this removes ALL parts in that slot). Exactly one of partId or category is required. Returns the new buildRevision, the digest and the validation delta. " +
      STALE_NUDGE,
    inputSchema: obj({
      partId: str("Id of a part currently in the build.", { maxLength: 80 }),
      category: enm(CATEGORIES, "Clear this whole slot (all parts for ram/storage)."),
      expectedRevision,
    }),
  },
  {
    name: "set_build_goal",
    readOnly: false,
    description:
      "Set the build goal: use case, budget in USD and optional preferences (enums only). The solver then also reports OVER_BUDGET, missing slots for the use case, tier imbalance, and noise/size preference mismatches; alternatives and fit_to_budget rank by the goal workload. The goal is part of build state, so this bumps buildRevision. " +
      STALE_NUDGE,
    inputSchema: obj(
      {
        useCase: enm(WORKLOADS, "Primary workload."),
        budgetUSD: num("Total budget in USD for the parts in the build.", { minimum: 1, maximum: 100000 }),
        preferences: {
          type: "object",
          description: "Optional preferences; every field is an enum.",
          properties: {
            noise: enm(["quiet", "standard"], "quiet flags loud parts (noise tier >= 4)."),
            size: enm(["compact", "standard", "any"], "compact flags cases over 25 L."),
            lighting: enm(["rgb", "none", "any"], "Lighting preference; affects the render prompt."),
            color: enm(["black", "white", "any"], "Case colour preference."),
          },
          additionalProperties: false,
        },
        expectedRevision,
      },
      ["useCase", "budgetUSD"],
    ),
  },
  {
    name: "reset_build",
    readOnly: false,
    description:
      "Clear every slot and the goal, giving an empty build and a new buildRevision. Requires confirm: true. The human can undo this from the activity feed. " +
      STALE_NUDGE,
    inputSchema: obj({ confirm: bool("Must be true to reset."), expectedRevision }, ["confirm"]),
  },
  {
    name: "render_build",
    readOnly: false,
    description:
      "Render the current build (needs a case) and show it on the page. Put every requested visual customization in flair in this same call; do not use a separate image-generation or image-editing workflow. Cold renders take 10-40 s; cache hits are free. On VERIFICATION_REQUIRED, ask the human to click Verify, then retry. Returns an artifact with imageUrl; resolve it against the page origin to download or embed it in a build-list or other document. Does not change buildRevision.",
    inputSchema: obj({
      style: enm(RENDER_STYLES, "Visual style; default photoreal."),
      angle: enm(RENDER_ANGLES, "Camera angle; default three-quarter."),
      flair: str("All requested cosmetic direction: subject, count, placement and colors. The tool applies it while preserving the selected hardware.", { maxLength: RENDER_FLAIR_MAX_LENGTH }),
    }),
  },
  {
    name: "suggest_alternatives",
    readOnly: true,
    description:
      "Rank swap candidates for one slot such that the swap adds no new errors and does not worsen existing conflicts. Each candidate has price delta, spec delta, validation delta, verified and a tradeoff sentence. direction: cheaper or better (all), quieter (cooler, gpu, psu, case), smaller (case, cooler, motherboard, psu); omitted = closest price at utility >= current. Inapplicable -> DIRECTION_NOT_APPLICABLE with the applicable list. Works for empty slots. Proposes only; apply with add_part.",
    inputSchema: obj(
      {
        category: enm(CATEGORIES, "Slot to find alternatives for."),
        direction: enm(DIRECTIONS, "Ranking direction; omit for closest price at equal or better utility."),
        count: int("Number of candidates, default 3, max 6.", { minimum: 1, maximum: 6 }),
        currentPartId: str("ram/storage only: which part in the slot the swap replaces (default: most expensive).", { maxLength: 80 }),
      },
      ["category"],
    ),
  },
  {
    name: "fit_to_budget",
    readOnly: true,
    description:
      "Bounded search over valid cheaper swaps to bring the build under budgetUSD with the least loss in the preserved metric, fewest swaps, most retained utility. Returns a proposal (proposalId, forBuildRevision, ordered ops with fromPartId/toPartId/savings/tradeoff, new total, validation). Not applied: apply each op with add_part {partId: toPartId, replace: true} (replacesPartId: fromPartId for ram/storage); on STALE_REVISION re-run this. Infeasible -> BUDGET_INFEASIBLE with cheapestTotal, blockedBy.",
    inputSchema: obj(
      {
        budgetUSD: num("Target total in USD.", { minimum: 1, maximum: 100000 }),
        protect: { type: "array", description: "Categories that must not change.", items: { type: "string", enum: [...CATEGORIES] }, maxItems: 8 },
        preserve: enm(PRESERVES, "Metric to preserve; default from the goal (quiet -> noise, compact -> size), else performance."),
      },
      ["budgetUSD"],
    ),
  },
  {
    name: "export_build",
    readOnly: true,
    description:
      "Export the current build. markdown: a parts list with prices, total and validation summary. json: {v:1, parts:[ids], goal}. url: a share link /b/<id>#b=<payload> that reloads this exact build (transport 'short+fragment' when the short id was stored, 'fragment' if the backend was unavailable - the link works either way). Read-only.",
    inputSchema: obj({ format: enm(["markdown", "json", "url"], "Output format.") }, ["format"]),
  },
];

export const toolByName = (name: ToolName): ToolDescriptor => TOOL_DEFINITIONS.find((t) => t.name === name)!;

/** Walks a JSON schema and yields every `description` string on a property (for the size test). */
export function parameterDescriptions(schema: unknown, path = ""): { path: string; description: string }[] {
  const out: { path: string; description: string }[] = [];
  if (typeof schema !== "object" || schema === null) return out;
  const s = schema as Record<string, unknown>;
  if (typeof s.description === "string" && path) out.push({ path, description: s.description });
  if (typeof s.properties === "object" && s.properties) {
    for (const [k, v] of Object.entries(s.properties as Record<string, unknown>)) out.push(...parameterDescriptions(v, path ? `${path}.${k}` : k));
  }
  if (s.items) out.push(...parameterDescriptions(s.items, `${path}[]`));
  return out;
}
