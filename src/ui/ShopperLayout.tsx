import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Part } from "../data/schema";
import { estimateWattage, goalRequiredSlots, partsIn, single, type Conflict as EngineConflict, type Goal, type RuleCode } from "../engine";
import { fragmentForPayload, payloadFromBuild, selectActiveRender, useStore, type FeedItem as StoreFeedItem, type HistoryEntry } from "../store";
import { GoalBanner } from "./GoalBanner";
import { PartBrowser } from "./PartBrowser";
import { Badge } from "./primitives/Badge";
import { Button } from "./primitives/Button";
import { Chip, WebMCPChip } from "./primitives/Chip";
import { ConflictCard } from "./primitives/ConflictCard";
import { FeedRow } from "./primitives/FeedRow";
import { Panel } from "./primitives/Panel";
import { PowerGauge } from "./primitives/PowerGauge";
import { PriceTicker } from "./primitives/PriceTicker";
import { RenderStage } from "./primitives/RenderStage";
import { SlotCard } from "./primitives/SlotCard";
import { renderCurrentBuild, verifySession } from "./renderClient";
import { clock, specLine, toSlotPart } from "./partSpec";
import type { Health, WebMCPState } from "./SystemStrip";
import { ToolsPopover, type ToolListing } from "./ToolsPopover";
import { dismissToast, toast, useToasts } from "./toast";
import { type Actor, type Category, type Conflict, type FeedItem, SLOT_ORDER, type SlotPart } from "./types";
import { partSelectionIntent } from "./partSelection";

export interface ShopperLayoutProps {
  health: Health | "error" | null;
  webmcp: WebMCPState;
  toolCount: number;
  tools: ToolListing[];
}

/** Categories a conflict points at: from its partIds, else a per-rule fallback for "missing" rules. */
function conflictSlots(c: EngineConflict, partCategory: (id: string) => Category | undefined, missing: Category[]): Category[] {
  const fromParts = [...new Set(c.partIds.map(partCategory).filter((x): x is Category => !!x))];
  if (fromParts.length) {
    // Point "X needs Y" rules at the empty slot too, so the fix jump lands on what to add.
    if (c.code === "COOLER_MISSING") return [...fromParts, "cooler"];
    if (c.code === "NO_IGPU_NO_GPU") return [...fromParts, "gpu"];
    return fromParts;
  }
  const fallback: Partial<Record<RuleCode, Category[]>> = {
    GOAL_SLOT_MISSING: missing,
    COOLER_MISSING: ["cooler"],
    NO_IGPU_NO_GPU: ["gpu"],
    PSU_INSUFFICIENT: ["psu"],
    PSU_LOW_HEADROOM: ["psu"],
    TIER_IMBALANCE: ["cpu", "gpu"],
    OVER_BUDGET: [],
  };
  return fallback[c.code] ?? [];
}

const stripActor = (t: string) => t.replace(/^[🤖👤]\s*/u, "");
const sentenceCase = (t: string) => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;

function toUiFeed(f: StoreFeedItem): FeedItem {
  const detail = [f.detail, f.resultSummary].filter(Boolean).join(" · ");
  return {
    id: f.id,
    actor: f.actor,
    title: sentenceCase(stripActor(f.title)),
    detail: detail || undefined,
    revision: f.kind === "note" ? undefined : f.buildRevision,
    time: clock(new Date(f.at)),
    undo: f.historyId ? (f.undo ?? "none") : undefined,
  };
}

export function ShopperLayout({ webmcp, toolCount, tools }: ShopperLayoutProps) {
  // ---- store ----
  const catalog = useStore((s) => s.catalog);
  const snapshotDate = useStore((s) => s.snapshotDate);
  const build = useStore((s) => s.build);
  const goal = useStore((s) => s.goal);
  const buildRevision = useStore((s) => s.buildRevision);
  const conflicts = useStore((s) => s.conflicts);
  const storeFeed = useStore((s) => s.feed);
  const history = useStore((s) => s.history);
  const renders = useStore((s) => s.renders);
  const activeRender = useStore(selectActiveRender);

  // ---- local UI state ----
  const [panelOpen, setPanelOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [popover, setPopover] = useState(false);
  const [tab, setTab] = useState<Category>("cpu");
  const [onlyMode, setOnlyMode] = useState<"auto" | "on" | "off">("auto");
  const [browserReset, setBrowserReset] = useState(0);
  const [seenFeed, setSeenFeed] = useState(0);
  const [showSchematic, setShowSchematic] = useState(false);
  const [needsVerify, setNeedsVerify] = useState(false);
  const browserRef = useRef<HTMLDivElement>(null);
  const toasts = useToasts();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const h = (e: MediaQueryListEvent) => setPanelOpen(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  useEffect(() => {
    if (drawerOpen || panelOpen) setSeenFeed(storeFeed.length);
  }, [drawerOpen, panelOpen, storeFeed.length]);

  // Ctrl+Z / ⌘Z → undo the top of the stack (human).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      const r = useStore.getState().undoLast("human");
      if (!r.ok) toast(r.message, "error");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- derived ----
  const buildEmpty = Object.values(build.slots).every((l) => !l || l.length === 0);
  const onlyCompatible = onlyMode === "auto" ? !buildEmpty : onlyMode === "on";
  const total = useStore((s) => Object.values(s.build.slots).flat().reduce((t, p) => t + (p?.priceUSD ?? 0), 0));
  const estWatts = useMemo(() => estimateWattage(build), [build]);
  const psu = single(build, "psu");
  const gpu = single(build, "gpu");
  const cs = single(build, "case");
  const cooler = single(build, "cooler");
  const motherboard = single(build, "motherboard");

  const slotParts = useMemo(() => {
    const out: Partial<Record<Category, { first: SlotPart; extra: number; firstId: string }>> = {};
    for (const c of SLOT_ORDER) {
      const list = partsIn(build, c);
      if (list.length) out[c] = { first: toSlotPart(list[0]), extra: list.length - 1, firstId: list[0].id };
    }
    return out;
  }, [build]);

  const partCategory = useCallback((id: string) => catalog?.byId.get(id)?.category, [catalog]);
  const missingSlots = useMemo(
    () => (goal ? goalRequiredSlots(goal.useCase).filter((c) => partsIn(build, c).length === 0) : []),
    [goal, build],
  );
  const uiConflicts: Conflict[] = useMemo(
    () => conflicts.map((c) => ({ code: c.code, severity: c.severity, explanation: c.explanation, slots: conflictSlots(c, partCategory, missingSlots) })),
    [conflicts, partCategory, missingSlots],
  );
  const errors = uiConflicts.filter((c) => c.severity === "error").length;
  const warnings = uiConflicts.filter((c) => c.severity === "warning").length;
  const attentionFor = (cat: Category) => {
    const hit = uiConflicts.filter((c) => c.slots.includes(cat));
    if (hit.some((c) => c.severity === "error")) return "error" as const;
    if (hit.some((c) => c.severity === "warning")) return "warning" as const;
    return undefined;
  };

  // Provenance flash: the latest history entry tells us who touched which slots.
  const last: HistoryEntry | undefined = history[history.length - 1];
  const flashFor = (cat: Category): Actor | null => (last && last.guard.some((g) => g.category === cat) ? last.actor : null);
  const flashCat = last?.guard[0]?.category;

  const filled = Object.fromEntries(SLOT_ORDER.map((c) => [c, !!slotParts[c]])) as Record<Category, boolean>;
  const uiFeed = useMemo(() => [...storeFeed].reverse().map(toUiFeed), [storeFeed]);
  const unread = Math.max(0, storeFeed.length - seenFeed);
  const canUndo = storeFeed.some((f) => f.undo === "available");
  const pendingRender = renders.find((r) => r.status === "pending");
  const supersededRenders = renders.filter((r) => r.status === "superseded" && r.imageUrl);
  // The agent's render_build leaves a failed artifact with the error code; the human's path sets needsVerify directly.
  const agentNeedsVerify = useMemo(() => {
    const lastAttempt = [...renders].reverse().find((r) => r.status !== "superseded");
    return lastAttempt?.status === "failed" && lastAttempt.error === "VERIFICATION_REQUIRED";
  }, [renders]);

  // ---- actions (all human) ----
  const openBrowser = (cat: Category, compatible?: boolean) => {
    setTab(cat);
    if (compatible !== undefined) setOnlyMode(compatible ? "on" : "off");
    setBrowserReset((n) => n + 1);
    setDrawerOpen(false);
    browserRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const addPart = (part: Part) => {
    const s = useStore.getState();
    const { replace, confirmation } = partSelectionIntent(part, s.build, s.goal);
    if (confirmation && !window.confirm(confirmation)) return;
    const r = s.addPart(part.id, { replace }, "human", { detail: `${replace ? "swapped in" : "added"} ${part.name} · ${specLine(part)}` });
    if (!r.ok) toast(r.message, "error");
  };
  const removeSlot = (cat: Category) => {
    const r = useStore.getState().removePart({ category: cat }, "human");
    if (!r.ok) toast(r.message, "error");
  };
  const undo = (feedId: string) => {
    const s = useStore.getState();
    const row = s.feed.find((f) => f.id === feedId);
    if (!row?.historyId) return;
    const r = s.undo(row.historyId, "human");
    if (!r.ok) toast(r.message, "error");
  };
  const undoLast = () => {
    const r = useStore.getState().undoLast("human");
    if (!r.ok) toast(r.message, "error");
  };
  const reset = () => {
    if (!window.confirm("Clear every slot and the goal? The activity feed keeps the history.")) return;
    useStore.getState().resetBuild("human");
  };
  const removeRender = (renderId: string) => {
    useStore.getState().removeRender(renderId);
    setShowSchematic(false);
  };
  const saveGoal = (g: Goal) => {
    const r = useStore.getState().setGoal(g, "human");
    if (!r.ok) toast(r.message, "error");
  };

  const share = async () => {
    const s = useStore.getState();
    const payload = payloadFromBuild(s.build, s.goal);
    if (!payload.parts.length) {
      toast("Add a part first — an empty build has nothing to share.", "error");
      return;
    }
    let path = `/${fragmentForPayload(payload)}`;
    try {
      const res = await fetch("/api/builds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; url?: string } | null;
      if (res.ok && body?.ok && body.url) path = body.url;
    } catch {
      /* fragment-only link still works */
    }
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(`Share link copied${path.startsWith("/b/") ? "" : " (fragment only — server unreachable)"}`);
    } catch {
      window.prompt("Copy this share link", url);
    }
    s.logFeed({ actor: "human", kind: "note", title: `shared build as ${path.startsWith("/b/") ? path.slice(0, path.indexOf("#")) : "a fragment link"}` });
  };

  const doRender = async (afterVerify = false) => {
    const s = useStore.getState();
    const r = await renderCurrentBuild();
    if (r.ok) {
      setNeedsVerify(false);
      setShowSchematic(false);
      s.logFeed({ actor: "human", kind: "note", title: `rendered build${r.render.cached ? " (cached)" : ""} · rev ${r.render.forBuildRevision}${r.render.status === "superseded" ? " · superseded" : ""}` });
      return;
    }
    if (r.code === "VERIFICATION_REQUIRED" && !afterVerify) {
      const v = await verifySession();
      if (v.ok) return doRender(true);
      setNeedsVerify(true);
      toast(`Verification needed: ${v.message}`, "error");
      return;
    }
    if (r.code === "VERIFICATION_REQUIRED") setNeedsVerify(true);
    toast(`Render: ${r.message}${r.retryAfterSec ? ` (retry in ${r.retryAfterSec} s)` : ""}`, "error", 7000);
    s.logFeed({ actor: "human", kind: "note", title: `render failed · ${r.code}`, error: r.message });
  };
  const verifyThenRender = async () => {
    const v = await verifySession();
    if (!v.ok) {
      toast(`Verification failed: ${v.message}`, "error");
      return;
    }
    setNeedsVerify(false);
    await doRender(true);
  };

  const partsCaption = SLOT_ORDER.map((c) => slotParts[c]?.first.name).filter(Boolean).join(", ");

  // ---- collaboration panel ----
  const collaboration = (
    <div className="flex flex-col gap-3 min-h-0 h-full">
      <Panel
        title="Validation"
        meta={
          errors === 0 && warnings === 0 ? (
            <span className="text-clear">all modeled checks pass</span>
          ) : (
            <span>
              {errors > 0 && <span className="text-fault">{errors} blocking</span>}
              {errors > 0 && warnings > 0 && " · "}
              {warnings > 0 && <span className="text-caution">{warnings} to check</span>}
            </span>
          )
        }
      >
        <div className="flex flex-col gap-2">
          {uiConflicts.map((c) => (
            <ConflictCard key={c.code + c.slots.join()} conflict={c} onFix={c.slots.length ? (x) => openBrowser(x.slots[x.slots.length - 1], true) : undefined} />
          ))}
          {uiConflicts.length === 0 && (
            <p className="text-spec text-dust">{buildEmpty ? "Add parts to start checking them against each other." : "Nothing to report against the modeled constraints."}</p>
          )}
        </div>
      </Panel>
      <Panel
        title="Activity"
        meta={`rev ${buildRevision}`}
        className="flex-1 min-h-0"
        bodyClassName="overflow-y-auto overscroll-contain"
        flush
        actions={
          <Button size="sm" variant="ghost" title="Ctrl+Z" onClick={undoLast} disabled={!canUndo}>
            Undo last
          </Button>
        }
      >
        <ul className="min-w-0 px-3 py-2">
          {uiFeed.map((f) => (
            <FeedRow key={f.id} item={f} onUndo={undo} />
          ))}
          {uiFeed.length === 0 && <li className="py-2 font-mono text-micro text-dust">Every change — yours or your agent's — lands here with its revision and an undo.</li>}
        </ul>
      </Panel>
    </div>
  );

  const slotCard = (c: Category, compact: boolean) => {
    const sp = slotParts[c];
    return (
      <SlotCard
        key={c}
        category={c}
        part={sp?.first}
        extraCount={sp?.extra ?? 0}
        compact={compact}
        attention={attentionFor(c)}
        flash={flashFor(c)}
        flashKey={buildRevision}
        onFill={() => openBrowser(c)}
        onSwap={sp ? () => openBrowser(c, true) : undefined}
        onRemove={sp ? () => removeSlot(c) : undefined}
      />
    );
  };

  return (
    <div className="min-h-screen flex flex-col lg:h-dvh lg:overflow-hidden">
      {/* ---------- header ---------- */}
      <header className="relative h-12 shrink-0 border-b border-seam bg-iron/80 backdrop-blur flex items-center gap-4 px-3 lg:px-4">
        <a href="/" className="flex items-center gap-2.5" aria-label="RigBuilder home">
          <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
            <rect x="3.5" y="2.5" width="17" height="19" rx="1" fill="none" stroke="var(--color-bone)" strokeWidth="1.5" />
            <rect x="6.5" y="6" width="11" height="4" fill="var(--color-ember)" />
            <rect x="6.5" y="12.5" width="7" height="1.6" fill="var(--color-glacier)" />
            <rect x="6.5" y="15.5" width="4.5" height="1.6" fill="var(--color-glacier)" />
          </svg>
          <span className="font-display text-mark font-bold uppercase tracking-[0.06em] leading-none">RigBuilder</span>
          <span className="hidden lg:inline font-mono text-micro text-dust mt-1 whitespace-nowrap">agent-native part picker</span>
        </a>
        <span className="flex-1" />
        <div className="hidden sm:block">
          <WebMCPChip state={webmcp} toolCount={toolCount} onClick={() => setPopover((v) => !v)} />
        </div>
        <div className="sm:hidden">
          <Chip tone={webmcp === "present" ? "ember" : "neutral"} dot={webmcp === "present"} onClick={webmcp === "present" ? () => setPopover((v) => !v) : undefined}>
            {webmcp === "present" ? `${toolCount} tools` : "no WebMCP"}
          </Chip>
        </div>
        {popover && <ToolsPopover tools={tools} onClose={() => setPopover(false)} />}
        <Button size="sm" variant="outline" onClick={share} title="Copy a link to this build">
          Share
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="max-lg:!hidden"
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
        >
          {panelOpen ? "Hide activity" : "Activity"}
          {!panelOpen && (errors > 0 || unread > 0) && <Badge tone="count">{errors || unread}</Badge>}
        </Button>
      </header>

      {/* ---------- body ---------- */}
      <div
        className={`flex-1 min-h-0 p-3 lg:p-4 grid gap-3 lg:gap-4 grid-cols-1 lg:grid-cols-[272px_minmax(0,1fr)] ${
          panelOpen ? "xl:grid-cols-[272px_minmax(0,1fr)_352px] lg:grid-cols-[272px_minmax(0,1fr)_352px]" : ""
        }`}
      >
        {/* region 1 — build slots (rail on narrow) */}
        <aside className="flex min-w-0 flex-col gap-3 order-2 lg:order-1 lg:min-h-0 lg:overflow-hidden">
          <div className="contents lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-3 lg:overflow-y-auto lg:pr-1">
            <GoalBanner goal={goal} onSave={saveGoal} />
            <div className="lg:hidden -mx-3 px-3 flex gap-2 overflow-x-auto snap-x pb-1">{SLOT_ORDER.map((c) => slotCard(c, true))}</div>
            <div className="hidden lg:flex flex-col gap-1.5">{SLOT_ORDER.map((c) => slotCard(c, false))}</div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-micro text-dust">
                {SLOT_ORDER.filter((c) => filled[c]).length}/8 slots
              </span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={reset} disabled={buildEmpty && !goal} title="Clear every slot and the goal">
                Reset
              </Button>
            </div>
          </div>
          <Panel className="lg:shrink-0">
            <PriceTicker total={Math.round(total)} budget={goal?.budgetUSD} />
            <div className="my-3 border-t border-seam" />
            <PowerGauge estWatts={estWatts} psuWatts={psu?.wattage} />
          </Panel>
        </aside>

        {/* region 2 — stage + browser */}
        <main className="flex flex-col gap-3 min-w-0 order-1 lg:order-2 lg:overflow-y-auto lg:pr-0.5">
          <RenderStage
            buildRevision={buildRevision}
            active={activeRender ?? null}
            superseded={supersededRenders}
            pending={!!pendingRender}
            showSchematic={showSchematic}
            onShowSchematic={setShowSchematic}
            onRender={() => void doRender()}
            onRemoveRender={removeRender}
            canRender={!!cs && !pendingRender}
            needsVerify={needsVerify || agentNeedsVerify}
            onVerify={() => void verifyThenRender()}
            caption={partsCaption}
            silhouette={{
              filled,
              parts: { case: cs, motherboard, gpu, cooler, psu },
              flash: last && flashCat ? { category: flashCat, actor: last.actor } : null,
            }}
          />
          <div ref={browserRef} className="flex flex-col flex-1 min-h-0">
            {catalog ? (
              <PartBrowser
                catalog={catalog}
                build={build}
                goal={goal}
                tab={tab}
                onTab={setTab}
                onlyCompatible={onlyCompatible}
                onOnlyCompatible={(v) => setOnlyMode(v ? "on" : "off")}
                onAdd={addPart}
                resetKey={browserReset}
              />
            ) : (
              <Panel title="Parts">
                <p className="font-mono text-micro text-dust">loading catalog…</p>
              </Panel>
            )}
          </div>
        </main>

        {/* region 3 — collaboration (column on wide, drawer on narrow) */}
        {panelOpen && <aside className="hidden lg:block min-w-0 order-3 min-h-0 lg:overflow-y-auto lg:pr-0.5">{collaboration}</aside>}
      </div>

      {/* drawer + FAB for narrow viewports */}
      <button
        onClick={() => setDrawerOpen(true)}
        className="lg:hidden fixed bottom-4 right-4 z-30 h-10 pl-3 pr-3.5 rounded-plate bg-iron border border-seam-strong engraved flex items-center gap-2 font-sans tracking-[0.01em] text-spec font-semibold"
      >
        <span className={`size-2 rounded-full ${errors ? "bg-fault" : warnings ? "bg-caution" : "bg-clear"}`} />
        Activity
        {(unread > 0 || errors > 0) && <Badge tone="count">{unread || errors}</Badge>}
      </button>
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40" role="dialog" aria-label="Validation and activity">
          <div className="absolute inset-0 bg-bone/35 backdrop-blur-[2px]" onClick={() => setDrawerOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-[min(92vw,380px)] bg-soot border-l border-seam p-3 flex flex-col gap-3 animate-drawer-in overflow-y-auto">
            <div className="flex items-center">
              <span className="eyebrow">Collaboration</span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => setDrawerOpen(false)}>
                Close
              </Button>
            </div>
            {collaboration}
          </div>
        </div>
      )}

      {/* toasts */}
      {toasts.length > 0 && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-12 z-50 flex flex-col gap-2 items-center pointer-events-none" aria-live="polite">
          {toasts.map((t) => (
            <button
              key={t.id}
              onClick={() => dismissToast(t.id)}
              className={`pointer-events-auto max-w-[min(92vw,520px)] rounded-plate border bg-iron engraved px-3 py-2 font-mono text-spec text-left animate-slide-in ${
                t.tone === "error" ? "border-fault text-fault" : "border-seam-strong text-bone"
              }`}
            >
              {t.message}
            </button>
          ))}
        </div>
      )}

      {/* ---------- footer ---------- */}
      <footer className="shrink-0 border-t border-seam px-3 lg:px-4 py-2 lg:py-0 lg:h-8 flex items-center">
        <span className="font-mono text-micro text-dust whitespace-nowrap overflow-hidden text-ellipsis">
          Indicative prices · modeled compatibility only · snapshot {snapshotDate ?? "pending"}
        </span>
      </footer>
    </div>
  );
}
