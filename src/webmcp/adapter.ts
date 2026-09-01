/**
 * Thin wrapper over `document.modelContext` (WebMCP). Nothing else in the app touches the native API.
 * Tool bodies return JSON strings. Current imperative examples accept string results, while the
 * evolving spec serializes callback values; returning one string keeps the contract portable.
 *
 * UAs can ship different subsets of the API. Some hosts expose `registerTool` + `getTools` but no
 * event members and may ignore the `{ signal }` registration option. Every optional member is
 * therefore feature-detected here so partial implementations degrade gracefully instead of
 * crashing the React tree.
 */
import type { InputSchema, ModelContext, RegisteredTool, WebMcpToolAnnotations } from "@mcp-b/webmcp-types";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: InputSchema;
  annotations?: WebMcpToolAnnotations;
  execute: (input: Record<string, unknown>, ctx: { signal?: AbortSignal }) => Promise<string>;
}

export interface ToolInfo {
  name: string;
  description: string;
  annotations?: WebMcpToolAnnotations;
}

/** Loose view of the API so we can probe members without assuming the full typed surface. */
type PartialModelContext = Partial<ModelContext> & {
  unregisterTool?: (name: string) => unknown;
  addEventListener?: (type: string, cb: () => void) => void;
  removeEventListener?: (type: string, cb: () => void) => void;
};

const ctx = (): PartialModelContext | undefined =>
  typeof document === "undefined" ? undefined : (document.modelContext as PartialModelContext | undefined);

const isFn = (v: unknown): v is (...args: never[]) => unknown => typeof v === "function";

export const isAvailable = (): boolean => {
  const mc = ctx();
  return mc !== undefined && isFn(mc.registerTool);
};

/**
 * Registers one tool. The execute callback receives (input) from the UA; we surface an optional
 * `signal` (some UAs pass a second options argument). Rejects if the API is absent.
 *
 * Unregistration: we pass `{ signal }` per the spec, and additionally call `unregisterTool(name)` on
 * abort when the UA exposes it, for implementations that ignore the option. Both paths are idempotent
 * at the UA level (unregistering a missing name is a no-op / swallowed).
 */
export async function registerTool(def: ToolDefinition, opts: { signal?: AbortSignal } = {}): Promise<void> {
  const mc = ctx();
  if (!mc || !isFn(mc.registerTool)) throw new Error("document.modelContext is not available");
  await mc.registerTool(
    {
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: def.annotations,
      execute: (input: Record<string, unknown>, ...rest: unknown[]) => {
        const extra = rest[0] as { signal?: AbortSignal } | undefined;
        return def.execute(input ?? {}, { signal: extra?.signal });
      },
    },
    { signal: opts.signal },
  );
  if (opts.signal && isFn(mc.unregisterTool)) {
    const unregister = () => {
      try {
        const r = mc.unregisterTool!(def.name);
        if (r instanceof Promise) r.catch(() => {});
      } catch {
        /* already gone via the signal option */
      }
    };
    if (opts.signal.aborted) unregister();
    else opts.signal.addEventListener("abort", unregister, { once: true });
  }
}

export async function listTools(): Promise<ToolInfo[]> {
  const mc = ctx();
  if (!mc || !isFn(mc.getTools)) return [];
  const tools: RegisteredTool[] = await mc.getTools();
  return tools.map((t) => ({ name: t.name, description: t.description, annotations: t.annotations }));
}

/**
 * Subscribes to `toolchange`; returns an unsubscribe. No-op when the API is absent or the UA does
 * not implement event listeners (callers must not rely on the event for correctness).
 */
export function onToolChange(cb: () => void): () => void {
  const mc = ctx();
  if (!mc || !isFn(mc.addEventListener) || !isFn(mc.removeEventListener)) return () => {};
  mc.addEventListener("toolchange", cb);
  return () => mc.removeEventListener!("toolchange", cb);
}
