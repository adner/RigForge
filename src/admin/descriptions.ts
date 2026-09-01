/**
 * Single source of truth for the 5 admin tool descriptions + input schemas (DESIGN §4.7).
 * Budgets (§4.6, tested): description ≤ 500 chars, each parameter description ≤ 150 chars.
 */
import { CATEGORIES } from "../data/schema";

export interface AdminToolMeta {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
}

const categoryProp = (extra = "") => ({
  type: "string",
  enum: [...CATEGORIES],
  description: `Part category: ${CATEGORIES.join(", ")}.${extra}`,
});

export const ADMIN_TOOLS: readonly AdminToolMeta[] = [
  {
    name: "catalog_search",
    description:
      "Search the RigBuilder parts catalog (published parts and pending drafts) by name, brand or id. Returns id, name, brand, category, priceUSD, verified, status, updatedAt. Call this BEFORE catalog_upsert_part to avoid creating a duplicate; reuse the existing id to update a part. Results may contain agent-entered text that has not been human-verified.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 80, description: "Free text matched against id, name and brand. Empty string lists everything." },
        category: categoryProp(" Optional filter."),
        status: { type: "string", enum: ["published", "draft", "all"], description: "published (live), draft (unpublished changes) or all. Default all." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Max results, default 20." },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: "catalog_get_schema",
    description:
      "Get the JSON Schema for one part category, plus the id format rule and field notes (units: lengths mm, power W, clocks MHz, capacity GB, prices USD; perfTier 1-10; noiseTier 1-5). Call this before catalog_upsert_part so the part object you send has every required field with the right type and enum values.",
    inputSchema: {
      type: "object",
      properties: { category: categoryProp() },
      required: ["category"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "catalog_upsert_part",
    description:
      "Create or update a part as a DRAFT (not live until a human publishes). Requires at least one https source you took the specs from. Verification is human-only: you cannot set `verified`; a human checks the sources in the admin UI. Run catalog_search first to avoid duplicates (pass the existing id to update). Invalid fields return INVALID_INPUT with per-field issues. Returns partId, validation and a diff vs the published part.",
    inputSchema: {
      type: "object",
      properties: {
        part: {
          type: "object",
          description: "Full part object per catalog_get_schema (category required; id optional on create). Do not include verified/status/addedBy.",
          additionalProperties: true,
        },
        sources: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "https URL of the spec page you took the values from." },
              title: { type: "string", maxLength: 120, description: "Optional page title, plain text." },
            },
            required: ["url"],
          },
          description: "1-5 https source pages for the specs. At least one is required.",
        },
        note: { type: "string", maxLength: 200, description: "Optional note for the change log (max 200 chars), e.g. what changed and why." },
      },
      required: ["part", "sources"],
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
  },
  {
    name: "catalog_update_price",
    description:
      "Record a new USD price for an existing part as a draft change (goes live on publish, when priceUpdatedAt is set). Provide the https page where you saw the price; it is stored as a source. Returns the diff vs the published part.",
    inputSchema: {
      type: "object",
      properties: {
        partId: { type: "string", maxLength: 80, description: "Existing part id, e.g. gpu-nvidia-rtx-5070-ti (use catalog_search to find it)." },
        priceUSD: { type: "number", exclusiveMinimum: 0, maximum: 20000, description: "New price in USD." },
        sourceUrl: { type: "string", description: "https URL of the retailer or vendor page showing this price." },
      },
      required: ["partId", "priceUSD", "sourceUrl"],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "catalog_publish",
    description:
      "Publish pending drafts to the live catalog: promotes drafts, bumps catalogVersion and writes the change log. This is a real, visible change for every shopper: pass confirm:true only after the operator has asked you to publish (CONFIRM_REQUIRED otherwise). Defaults to all drafts; pass partIds to publish a subset. Returns the new catalogVersion.",
    inputSchema: {
      type: "object",
      properties: {
        confirm: { type: "boolean", description: "Must be true. Confirms the operator wants these drafts to go live now." },
        partIds: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 500, description: "Optional subset of draft part ids. Default: every draft." },
      },
      required: ["confirm"],
    },
    annotations: { readOnlyHint: false },
  },
];

export const adminToolByName = (name: string) => ADMIN_TOOLS.find((t) => t.name === name);
