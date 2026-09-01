/**
 * Boot-time registration of the 14 shopper tools (DESIGN §3.3). One AbortController; Promise.allSettled;
 * failures go to console + activity feed; the chip reads the count of successful registrations and
 * re-reads getTools() on `toolchange`.
 */
import { useStore } from "../store";
import { isAvailable, listTools, onToolChange, registerTool, type ToolInfo } from "./adapter";
import { TOOL_DEFINITIONS } from "./descriptions";
import { initLastSeen } from "./lastSeen";
import { shopperToolDefinitions } from "./tools";

export interface Registration {
  /** Unregisters every shopper tool (aborts the shared AbortController). */
  abort(): void;
  /** Number of tools successfully registered (0 when WebMCP is absent). */
  count: number;
  /** Subscribe to live tool-count changes (every `toolchange`). Calls back immediately with the current count. */
  onCount(cb: (count: number) => void): () => void;
}

/**
 * Module-level, ref-counted registration. WebMCP tool names are unique per page, and React's dev-mode
 * StrictMode mounts effects twice: the second mount used to start a second batch of `registerTool()`
 * calls while the first was still in flight ("Duplicate tool name" ×14, then the first batch got aborted
 * by the stale cleanup). All callers now share one in-flight registration; the browser-side
 * unregistration (controller.abort()) happens only when the last holder releases it.
 */
let shared: Promise<Registration> | null = null;
let holders = 0;

export async function registerShopperTools(): Promise<Registration> {
  holders++;
  if (!shared) shared = createRegistration();
  const inner = await shared;
  let released = false;
  return {
    abort() {
      if (released) return;
      released = true;
      holders--;
      if (holders <= 0) {
        holders = 0;
        shared = null;
        inner.abort();
      }
    },
    get count() {
      return inner.count;
    },
    onCount: (cb) => inner.onCount(cb),
  };
}

/** Test hook: forget the shared registration without touching the UA. */
export function resetSharedRegistrationForTests(): void {
  shared = null;
  holders = 0;
}

/**
 * Registers all 14 tools with one AbortController and resolves once every registration has settled.
 * Never rejects: per-tool failures are logged to console + feed and excluded from `count`.
 */
async function createRegistration(): Promise<Registration> {
  const controller = new AbortController();
  const listeners = new Set<(n: number) => void>();
  let latest = 0;
  const emit = (n: number) => {
    latest = n;
    for (const l of listeners) l(n);
  };

  initLastSeen(useStore.getState().buildRevision);

  const shopperNames = new Set<string>(TOOL_DEFINITIONS.map((t) => t.name));
  async function refreshCount(): Promise<number | null> {
    try {
      const tools = await listTools();
      return tools.filter((t) => shopperNames.has(t.name)).length;
    } catch {
      return null;
    }
  }

  const count: number = await (async () => {
    if (!isAvailable()) {
      emit(0);
      return 0;
    }
    const defs = shopperToolDefinitions();
    const results = await Promise.allSettled(defs.map((d) => registerTool(d, { signal: controller.signal })));
    let okCount = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") okCount++;
      else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.error(`[webmcp] failed to register ${defs[i]!.name}: ${msg}`);
        useStore.getState().logFeed({ actor: "agent", kind: "note", title: `WebMCP: failed to register ${defs[i]!.name}`, error: msg, undo: "none" });
      }
    });
    // Prefer the UA's own view when available.
    const live = await refreshCount();
    emit(live ?? okCount);
    return live ?? okCount;
  })();

  void count;
  const unsubscribe = onToolChange(() => {
    void refreshCount().then((n) => n !== null && emit(n));
  });

  return {
    abort() {
      unsubscribe();
      controller.abort();
      emit(0);
    },
    get count() {
      return latest;
    },
    onCount(cb) {
      listeners.add(cb);
      cb(latest);
      return () => listeners.delete(cb);
    },
  };
}

export interface PopoverTool {
  name: string;
  description: string;
  readOnly: boolean;
  /** true once the UA reports it as registered. */
  registered: boolean;
}

/** Tool list for the status-chip popover: the static definitions merged with what the UA reports. */
export async function getToolListForPopover(): Promise<PopoverTool[]> {
  let live: ToolInfo[] = [];
  try {
    live = await listTools();
  } catch {
    live = [];
  }
  const liveNames = new Set(live.map((t) => t.name));
  return TOOL_DEFINITIONS.map((t) => ({ name: t.name, description: t.description, readOnly: t.readOnly, registered: liveNames.has(t.name) }));
}
