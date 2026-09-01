/**
 * The 5 admin WebMCP tools (DESIGN §4.7), registered only while `/admin` is mounted.
 *
 * Trust boundary (§8): agents DRAFT; humans VERIFY (admin UI only) and PUBLISH (or the
 * agent publishes with an explicit confirm). No tool here can set `verified`, and none
 * ever calls the verify route. Every call is logged as a 🤖 row in the admin change log.
 */
import { jsonSchemaFor } from "./schema";
import { logActivity } from "./activity";
import { adminApi, type AdminApi, type StatusFilter } from "./api";
import { ADMIN_TOOLS, type AdminToolMeta } from "./descriptions";
import { fail, ok, toEnvelope, type AdminEnvelope } from "./envelope";
import { isCategory, validatePriceInput, validateUpsertInput } from "./validate";
import { isAvailable, registerTool, type ToolDefinition } from "../webmcp/adapter";
import { ID_PREFIX } from "../data/schema";

export interface AdminToolDeps {
  api?: AdminApi;
  /** Called after any successful mutation so the UI can refresh its table. */
  onMutation?: () => void;
  log?: typeof logActivity;
}

type Handler = (input: Record<string, unknown>) => Promise<AdminEnvelope>;

const FIELD_NOTES = {
  units: "lengths mm, power W, clocks MHz, capacity GB, prices USD; perfTier 1-10; noiseTier 1-5 (1 = near-silent)",
  id: "optional on create; format <prefix>-<slug>, prefixes: " + Object.values(ID_PREFIX).join(", "),
  text: "name <= 80 and brand <= 40 chars, plain text only (no URLs, markup or newlines)",
  sources: "https URLs only, max 5; record the spec page you took the values from",
  verified: "human-only; agents cannot set it — leave it out",
};

/** Pure handlers: input → envelope. Exported for tests; `registerAdminTools` wraps them. */
export function createAdminHandlers(deps: AdminToolDeps = {}): Record<string, Handler> {
  const api = deps.api ?? adminApi;
  const log = deps.log ?? logActivity;
  const mutated = () => deps.onMutation?.();

  const guard =
    (name: string, fn: Handler): Handler =>
    async (input) => {
      let env: AdminEnvelope;
      try {
        env = await fn(input ?? {});
      } catch (e) {
        env = toEnvelope(e);
      }
      const partId = (input?.partId as string | undefined) ?? (env.ok ? (env.data as { partId?: string })?.partId : undefined);
      log("agent", `${name}${partId ? ` · ${partId}` : ""}`, env.ok ? `→ ok · ${env.summary}` : `→ ${env.error.code} · ${env.error.message}`);
      return env;
    };

  return {
    catalog_search: guard("catalog_search", async (input) => {
      const query = typeof input.query === "string" ? input.query.slice(0, 80) : "";
      const category = isCategory(input.category) ? input.category : undefined;
      const status: StatusFilter = input.status === "published" || input.status === "draft" ? input.status : "all";
      const limit = Math.min(50, Math.max(1, Number(input.limit) || 20));
      const res = await api.listParts({ q: query || undefined, category, status, limit });
      return ok(`${res.parts.length} part(s) matched${query ? ` "${query}"` : ""}${category ? ` in ${category}` : ""}`, {
        count: res.parts.length,
        parts: res.parts,
      });
    }),

    catalog_get_schema: guard("catalog_get_schema", async (input) => {
      if (!isCategory(input.category)) return fail("INVALID_INPUT", "Unknown category", { category: input.category });
      return ok(`JSON Schema for ${input.category}`, { category: input.category, schema: jsonSchemaFor(input.category), notes: FIELD_NOTES });
    }),

    catalog_upsert_part: guard("catalog_upsert_part", async (input) => {
      const v = validateUpsertInput({ part: input.part, sources: input.sources });
      if (!v.ok) return fail(v.code, v.message, { issues: v.issues });
      const note = typeof input.note === "string" ? input.note.slice(0, 200) : undefined;
      const res = await api.upsertDraft(v.part, "agent", note);
      mutated();
      const isNew = res.diff.length === 1 && res.diff[0].field === "*";
      return ok(`Draft ${isNew ? "created" : "updated"}: ${res.partId} (${v.category}) — unverified until a human checks the sources; not live until published`, {
        partId: res.partId,
        status: "draft",
        validation: res.validation,
        diff: res.diff,
      });
    }),

    catalog_update_price: guard("catalog_update_price", async (input) => {
      const v = validatePriceInput(input);
      if (!v.ok) return fail(v.code, v.message, { issues: v.issues });
      const res = await api.updatePrice(v.partId, v.priceUSD, v.sourceUrl, "agent");
      mutated();
      return ok(`Draft price for ${v.partId}: $${v.priceUSD} (live on publish)`, { partId: res.partId, status: "draft", diff: res.diff });
    }),

    catalog_publish: guard("catalog_publish", async (input) => {
      if (input.confirm !== true) {
        return fail("CONFIRM_REQUIRED", "Publishing changes the live catalog for every shopper. Ask the operator, then call again with confirm:true.");
      }
      const partIds = Array.isArray(input.partIds) ? input.partIds.filter((s): s is string => typeof s === "string").slice(0, 500) : undefined;
      const res = await api.publish(partIds, "agent");
      mutated();
      return ok(`Published ${res.published} part(s); catalog is now v${res.catalogVersion}`, res);
    }),
  };
}

const toDefinition = (meta: AdminToolMeta, handler: Handler): ToolDefinition => ({
  name: meta.name,
  description: meta.description,
  inputSchema: meta.inputSchema as ToolDefinition["inputSchema"],
  annotations: meta.annotations,
  execute: async (input) => JSON.stringify(await handler(input)),
});

/**
 * Registers all admin tools with one AbortController. Resolves with the count of
 * successful registrations (failures are logged, never thrown). `abort()` unregisters.
 */
/**
 * Ref-counted like the shopper registration (see src/webmcp/register.ts): StrictMode double-mounts
 * must not start two concurrent `registerTool()` batches ("Duplicate tool name").
 */
let sharedAdmin: Promise<{ abort: () => void; count: number }> | null = null;
let adminHolders = 0;

export async function registerAdminTools(deps: AdminToolDeps = {}): Promise<{ abort: () => void; count: number }> {
  adminHolders++;
  if (!sharedAdmin) sharedAdmin = createAdminRegistration(deps);
  const inner = await sharedAdmin;
  let released = false;
  return {
    abort() {
      if (released) return;
      released = true;
      adminHolders--;
      if (adminHolders <= 0) {
        adminHolders = 0;
        sharedAdmin = null;
        inner.abort();
      }
    },
    get count() {
      return inner.count;
    },
  };
}

/** Test hook. */
export function resetSharedAdminRegistrationForTests(): void {
  sharedAdmin = null;
  adminHolders = 0;
}

async function createAdminRegistration(deps: AdminToolDeps): Promise<{ abort: () => void; count: number }> {
  const controller = new AbortController();
  if (!isAvailable()) return { abort: () => controller.abort(), count: 0 };
  const handlers = createAdminHandlers(deps);
  const results = await Promise.allSettled(ADMIN_TOOLS.map((meta) => registerTool(toDefinition(meta, handlers[meta.name]), { signal: controller.signal })));
  let count = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") count++;
    else {
      console.error(`[webmcp] failed to register ${ADMIN_TOOLS[i].name}`, r.reason);
      (deps.log ?? logActivity)("agent", `register ${ADMIN_TOOLS[i].name} failed`, String(r.reason));
    }
  });
  return { abort: () => controller.abort(), count };
}
