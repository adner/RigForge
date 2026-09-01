/**
 * Shopper boot sequence (DESIGN §3, §7.2):
 *   1. loadCatalog() → store.setCatalog
 *   2. share/load: `#b=` fragment first (always present in our links), else `/b/<id>` → GET /api/builds/:id
 *   3. registerShopperTools() once (StrictMode-safe: aborted on unmount) → real tool count + popover list
 * Renders are never requested at boot (they cost money); a cached render appears only after an explicit render.
 */
import { useEffect, useState } from "react";
import { loadCatalog } from "../catalog/loader";
import { indexCatalog } from "../engine";
import { decodeShare, shareFromFragment, useStore, type LoadPayload } from "../store";
import { readPersistedBuild, restorePersistedBuild, startBuildPersistence } from "../store/persist";
import { isAvailable, listTools, onToolChange } from "../webmcp/adapter";
import { getToolListForPopover, registerShopperTools } from "../webmcp/register";
import type { WebMCPState } from "./SystemStrip";
import type { ToolListing } from "./ToolsPopover";
import { toast } from "./toast";

export interface BootState {
  webmcp: WebMCPState;
  toolCount: number;
  tools: ToolListing[];
  catalogReady: boolean;
}

async function payloadFromLocation(): Promise<{ payload?: LoadPayload; error?: string }> {
  const frag = shareFromFragment(window.location.hash);
  if (frag !== null) {
    const r = decodeShare(frag);
    if (r.ok) return { payload: r.payload };
    return { error: r.message };
  }
  const m = /^\/b\/([a-z2-7]{10})\/?$/.exec(window.location.pathname);
  if (m) {
    try {
      const res = await fetch(`/api/builds/${m[1]}`, { headers: { accept: "application/json" } });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; payload?: LoadPayload; error?: { message?: string } } | null;
      if (res.ok && body?.ok && body.payload) return { payload: body.payload };
      return { error: body?.error?.message ?? (res.status === 404 ? "that shared build no longer exists" : "could not load the shared build") };
    } catch {
      return { error: "could not reach the server to load the shared build" };
    }
  }
  return {};
}

export function useShopperBoot(): BootState {
  const [state, setState] = useState<BootState>({ webmcp: "detecting", toolCount: 0, tools: [], catalogReady: false });

  // 1 + 2: catalog, then share payload (needs the catalog to resolve ids).
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      const { catalog, source } = await loadCatalog({ signal: ac.signal });
      if (ac.signal.aborted) return;
      useStore.getState().setCatalog(indexCatalog(catalog), { catalogVersion: catalog.catalogVersion, source, snapshotDate: catalog.snapshotDate });
      setState((s) => ({ ...s, catalogReady: true }));
      const { payload, error } = await payloadFromLocation();
      if (ac.signal.aborted) return;
      if (error) toast(`Share link: ${error}`, "error");
      if (payload) {
        const r = useStore.getState().loadBuild(payload, "human", { detail: "loaded from share link" });
        if (!r.ok) toast(`Could not load the shared build: ${r.message}`, "error");
        else if (r.notice) toast(r.notice, "error", 8000);
        else toast(`Loaded shared build (${payload.parts.length} parts)`);
      } else {
        const saved = readPersistedBuild(window.localStorage);
        if (saved) {
          const r = await restorePersistedBuild(saved);
          if (!r.ok) toast(`Could not restore the saved build: ${r.message}`, "error");
          else if (r.notice) toast(`Restored saved build. ${r.notice}`, "error", 8000);
          else toast(`Restored saved build (${saved.payload.parts.length} parts)`);
        }
      }
      startBuildPersistence(window.localStorage);
    })().catch((e) => {
      if (!ac.signal.aborted) toast(`Boot failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    });
    return () => ac.abort();
  }, []);

  // 3: WebMCP registration (StrictMode runs this twice in dev; abort() unregisters cleanly).
  useEffect(() => {
    const present = isAvailable();
    setState((s) => ({ ...s, webmcp: present ? "present" : "absent" }));
    if (!present) return;
    let cancelled = false;
    let abort: (() => void) | undefined;
    const refresh = async () => {
      const [live, described] = await Promise.all([listTools(), Promise.resolve(getToolListForPopover())]);
      if (cancelled) return;
      const tools: ToolListing[] = (live.length ? live : described).map((t) => ({ name: t.name, description: t.description }));
      setState((s) => ({ ...s, toolCount: tools.length, tools }));
    };
    (async () => {
      const reg = await Promise.resolve(registerShopperTools());
      if (cancelled) {
        reg.abort();
        return;
      }
      abort = reg.abort;
      setState((s) => ({ ...s, toolCount: reg.count }));
      await refresh();
    })().catch((e) => console.warn("WebMCP registration failed", e));
    const off = onToolChange(() => void refresh());
    return () => {
      cancelled = true;
      off();
      abort?.();
    };
  }, []);

  return state;
}
