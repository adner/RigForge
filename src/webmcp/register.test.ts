import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerShopperTools, resetSharedRegistrationForTests } from "./register";
import { useStore } from "../store";

/** Minimal fake of document.modelContext that enforces unique tool names like the browser does. */
function fakeModelContext() {
  const tools = new Map<string, { name: string; description: string }>();
  let registerCalls = 0;
  const listeners = new Set<() => void>();
  const mc = {
    async registerTool(def: { name: string; description: string }, opts?: { signal?: AbortSignal }) {
      registerCalls++;
      await Promise.resolve(); // simulate the UA settling asynchronously
      if (tools.has(def.name)) throw new Error("Duplicate tool name");
      tools.set(def.name, def);
      opts?.signal?.addEventListener("abort", () => {
        tools.delete(def.name);
        for (const l of listeners) l();
      });
    },
    async getTools() {
      return [...tools.values()];
    },
    addEventListener(_: string, cb: () => void) {
      listeners.add(cb);
    },
    removeEventListener(_: string, cb: () => void) {
      listeners.delete(cb);
    },
  };
  return { mc, tools, get registerCalls() { return registerCalls; } };
}

describe("registerShopperTools is a ref-counted singleton (StrictMode double-mount safe)", () => {
  let fake: ReturnType<typeof fakeModelContext>;
  beforeEach(() => {
    resetSharedRegistrationForTests();
    useStore.getState().resetAll?.();
    fake = fakeModelContext();
    (globalThis as { document?: unknown }).document = { modelContext: fake.mc };
  });
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it("two concurrent mounts share one registration; no duplicate-name errors; last release unregisters", async () => {
    // Mount 1 starts, cleanup fires before it settles, mount 2 starts — exactly the StrictMode sequence.
    const p1 = registerShopperTools();
    const p2 = registerShopperTools();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fake.registerCalls).toBe(14);
    expect(fake.tools.size).toBe(14);
    expect(r1.count).toBe(14);
    expect(r2.count).toBe(14);

    r1.abort(); // stale cleanup from mount 1
    expect(fake.tools.size).toBe(14); // still held by mount 2
    r1.abort(); // idempotent
    expect(fake.tools.size).toBe(14);

    r2.abort(); // real unmount
    expect(fake.tools.size).toBe(0);
  });

  it("re-registers cleanly after a full release (e.g. HMR / route change)", async () => {
    const r = await registerShopperTools();
    r.abort();
    const again = await registerShopperTools();
    expect(again.count).toBe(14);
    expect(fake.registerCalls).toBe(28);
    again.abort();
  });
});

describe("partial UA shapes (ChatGPT in-app browser: registerTool + getTools only)", () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it("registers, counts and releases without addEventListener or a honoured signal option", async () => {
    resetSharedRegistrationForTests();
    const tools = new Map<string, { name: string; description: string }>();
    const mc = {
      async registerTool(def: { name: string; description: string }) {
        if (tools.has(def.name)) throw new Error("Duplicate tool name");
        tools.set(def.name, def); // ignores opts.signal entirely
      },
      async unregisterTool(name: string) {
        tools.delete(name);
      },
      async getTools() {
        return [...tools.values()];
      },
    };
    (globalThis as { document?: unknown }).document = { modelContext: mc };

    const r = await registerShopperTools();
    expect(r.count).toBe(14);
    expect(tools.size).toBe(14);
    r.abort();
    await Promise.resolve();
    expect(tools.size).toBe(0); // released via unregisterTool fallback
  });
});
