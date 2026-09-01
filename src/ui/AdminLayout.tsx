import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logActivity, useAdminActivity } from "../admin/activity";
import { adminApi, type CardAvailability, type ChangeLogEntry, type FieldDiff, type PartDetail } from "../admin/api";
import { ADMIN_TOOLS } from "../admin/descriptions";
import { AdminApiError } from "../admin/envelope";
import { registerAdminTools } from "../admin/tools";
import { resolveIndexedCardKind } from "../admin/cardStatus";
import type { Part } from "../data/schema";
import { listTools, onToolChange } from "../webmcp/adapter";
import { AddPartForm } from "./admin/AddPartForm";
import { Badge } from "./primitives/Badge";
import { Button } from "./primitives/Button";
import { WebMCPChip } from "./primitives/Chip";
import { FeedRow } from "./primitives/FeedRow";
import { Panel } from "./primitives/Panel";
import { PartThumbnail } from "./primitives/PartThumbnail";
import { SystemStrip, type Health, type WebMCPState } from "./SystemStrip";
import { ToolsPopover, type ToolListing } from "./ToolsPopover";
import { type Category, CATEGORY_LABEL, type FeedItem, SLOT_ORDER } from "./types";
import { genericCardArchetype } from "../engine/cardArchetype";

type StatusFilter = "all" | "published" | "draft";
type Gate = { kind: "unauthorized" | "not-configured" | "unavailable"; message: string } | null;
type CardKind = "specific" | "generic" | "none" | "loading" | "error";

const select = "h-7 bg-soot border border-seam rounded-chamfer px-2 font-mono text-spec text-bone outline-none focus:border-glacier";
const fmtDate = (iso: string) => iso.slice(0, 10);
const fmtTime = (iso: string) => iso.replace("T", " ").slice(0, 16);
const fmtVal = (v: unknown) => (v === undefined || v === null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
const gateOf = (e: unknown): Gate => {
  if (!(e instanceof AdminApiError)) return null;
  if (e.code === "UNAUTHORIZED") return { kind: "unauthorized", message: e.message };
  if (e.code === "ACCESS_NOT_CONFIGURED") return { kind: "not-configured", message: e.message };
  if (e.code === "BACKEND_UNAVAILABLE") return { kind: "unavailable", message: e.message };
  return null;
};
const errText = (e: unknown) => (e instanceof AdminApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));

const ACTION_LABEL: Record<string, string> = {
  draft_create: "Added draft",
  draft_update: "Updated draft",
  draft_price: "Price",
  verify: "Verified",
  unverify: "Unverified",
  discard: "Discarded draft",
  publish_part: "Published part",
  publish: "Published catalog",
};

/** A server change_log row as a feed item: agent rows get the robot icon, everything else the human one. */
const entryToFeed = (e: ChangeLogEntry, i: number): FeedItem => {
  const label = ACTION_LABEL[e.action] ?? e.action;
  const actionDetail = e.action === "draft_price" && e.detail ? `$${e.detail}` : (e.detail ?? undefined);
  const detail = [e.identity ? `by ${e.identity}` : undefined, actionDetail].filter(Boolean).join(" · ") || undefined;
  return {
    id: `s${e.at}-${i}`,
    actor: e.actor === "agent" ? "agent" : "human",
    title: e.partId ? `${label} · ${e.partId}` : label,
    detail: e.actor === "seed" || e.actor === "system" ? [e.actor, detail].filter(Boolean).join(" · ") : detail,
    time: new Date(e.at).toTimeString().slice(0, 8),
    at: e.at,
    undo: "none",
  };
};

/**
 * Server log + session items, newest first. Session items are the optimistic view of
 * the same rows: keep only those logged since the last successful server fetch, so a
 * tool call between refreshes is visible immediately and drops out once its row lands.
 */
const mergeLogs = (server: FeedItem[], session: FeedItem[], fetchedAt: string): FeedItem[] => {
  const pending = fetchedAt ? session.filter((s) => !s.at || s.at >= fetchedAt) : session;
  return [...pending, ...server];
};

/**
 * `/admin` — the operator side (DESIGN §7.3). Catalog table from GET /api/admin/parts,
 * draft diff panel, human-only Verify, Discard, Publish; the 5 admin WebMCP tools are
 * registered while this route is mounted and every tool call lands in the change log.
 */
export function AdminLayout({ health, webmcp }: { health: Health | "error" | null; webmcp: WebMCPState }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [rows, setRows] = useState<Part[]>([]);
  const [total, setTotal] = useState(0);
  const [gate, setGate] = useState<Gate>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PartDetail | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [catalogVersion, setCatalogVersion] = useState<number | null>(null);
  const [viewerIdentity, setViewerIdentity] = useState<string | null>(null);
  const [viewerRole, setViewerRole] = useState<"owner" | "contributor" | null>(null);
  const [toolCount, setToolCount] = useState(0);
  const [tools, setTools] = useState<ToolListing[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [cardAvailability, setCardAvailability] = useState<CardAvailability | "error" | null>(null);
  const sessionLog = useAdminActivity((s) => s.items);
  const [serverLog, setServerLog] = useState<FeedItem[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [logFetchedAt, setLogFetchedAt] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    setToast({ text, tone });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), tone === "ok" ? 4000 : 8000);
  }, []);

  // ---------- data ----------
  const refresh = useCallback(async () => {
    try {
      const [res, session] = await Promise.all([
        adminApi.listPartsFull({ q: q || undefined, category: cat === "all" ? undefined : cat, status, limit: 500 }),
        adminApi.getSession(),
      ]);
      setRows(res.parts);
      setViewerIdentity(session.identity);
      setViewerRole(session.role);
      setGate(null);
      const all = q === "" && cat === "all" && status === "all" ? res.count : (await adminApi.listParts({ status: "all", limit: 1000 })).count;
      setTotal(all);
    } catch (e) {
      const g = gateOf(e);
      if (g) setGate(g);
      else notify(errText(e), "err");
    }
  }, [q, cat, status, notify]);

  const loadDetail = useCallback(async (id: string | null) => {
    if (!id) return setDetail(null);
    try {
      setDetail(await adminApi.getPart(id));
    } catch {
      setDetail(null);
    }
  }, []);

  const loadVersion = useCallback(async () => {
    try {
      const r = await fetch("/api/catalog", { credentials: "same-origin" });
      if (r.ok) setCatalogVersion(((await r.json()) as { catalogVersion?: number }).catalogVersion ?? null);
    } catch {
      /* footer just shows "v?" */
    }
  }, []);

  const loadCardAvailability = useCallback(async () => {
    try {
      setCardAvailability(await adminApi.getCardAvailability());
    } catch {
      setCardAvailability("error");
    }
  }, []);

  const loadLog = useCallback(async (before?: string) => {
    const started = new Date().toISOString();
    try {
      const page = await adminApi.listChangeLog({ limit: 50, before });
      const items = page.entries.map(entryToFeed);
      setServerLog((prev) => (before ? [...prev, ...items] : items));
      setNextBefore(page.nextBefore);
      if (!before) setLogFetchedAt(started);
    } catch {
      /* the session log still shows; the gate (if any) is reported by refresh() */
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(refresh, q ? 200 : 0);
    return () => window.clearTimeout(t);
  }, [refresh, q]);
  useEffect(() => void loadVersion(), [loadVersion]);
  useEffect(() => void loadCardAvailability(), [loadCardAvailability]);
  useEffect(() => void loadLog(), [loadLog]);
  useEffect(() => void loadDetail(selectedId), [selectedId, loadDetail]);

  // Keep the selected draft in sync after mutations; auto-select the newest draft when nothing is selected.
  const drafts = rows.filter((r) => r.status === "draft");
  const publishedIds = useMemo(() => new Set(rows.filter((r) => r.status === "published").map((r) => r.id)), [rows]);
  const publishableDrafts = viewerRole === "contributor" ? drafts.filter((draft) => !publishedIds.has(draft.id)) : drafts;
  useEffect(() => {
    if (selectedId && !rows.some((r) => r.id === selectedId && r.status === "draft") && status !== "published") setSelectedId(null);
    else if (!selectedId && drafts.length) setSelectedId([...drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0].id);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- WebMCP: register the admin tools while mounted ----------
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (webmcp !== "present") return;
    let abort: (() => void) | undefined;
    let cancelled = false;
    setTools(ADMIN_TOOLS.map(({ name, description }) => ({ name, description })));
    const recount = () =>
      listTools()
        .then((ts) => {
          const adminTools = ts.filter((t) => ADMIN_TOOLS.some((a) => a.name === t.name));
          const listed = adminTools.length ? adminTools : ADMIN_TOOLS;
          setToolCount((count) => (adminTools.length ? adminTools.length : count));
          setTools(listed.map(({ name, description }) => ({ name, description })));
        })
        .catch(() => {});
    registerAdminTools({
      onMutation: () => {
        refreshRef.current();
        loadVersion();
        loadLog();
        if (selectedId) loadDetail(selectedId);
      },
    }).then((r) => {
      if (cancelled) return r.abort();
      abort = r.abort;
      setToolCount(r.count);
      recount();
    });
    const off = onToolChange(recount);
    return () => {
      cancelled = true;
      abort?.();
      off();
      setToolCount(0);
      setTools([]);
      setToolsOpen(false);
    };
  }, [webmcp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tool mutations refresh the table; reload the open draft too.
  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- human actions (👤) ----------
  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(true);
    try {
      const msg = await fn();
      if (msg) notify(msg);
      await Promise.all([refresh(), loadLog()]);
    } catch (e) {
      const g = gateOf(e);
      if (g) setGate(g);
      const text = errText(e);
      logActivity("human", `${label} failed`, text);
      notify(text, "err");
    } finally {
      setBusy(false);
    }
  };

  const setPrice = (r: Part, priceUSD: number) => {
    if (!Number.isFinite(priceUSD) || priceUSD <= 0 || priceUSD === r.priceUSD) return;
    run("update price", async () => {
      await adminApi.updatePrice(r.id, priceUSD, undefined, "human");
      logActivity("human", `Price · ${r.name} → $${priceUSD}`, `was $${r.priceUSD} · draft until publish`);
      setSelectedId(r.id);
      return `Draft price for ${r.id}: $${priceUSD}`;
    });
  };

  const setSources = (draft: Part, urls: string[]) =>
    run("edit sources", async () => {
      const { status: _s, verified: _v, addedBy: _a, updatedAt: _u, ...rest } = draft;
      void _s;
      void _v;
      void _a;
      void _u;
      await adminApi.upsertDraft({ ...rest, sources: urls.map((url) => ({ url })) }, "human", "sources edited");
      logActivity("human", `Sources · ${draft.name}`, `${urls.length} source(s)`);
      return `Sources updated for ${draft.id}`;
    });

  const verify = (draft: Part) =>
    run("verify", async () => {
      const next = !draft.verified;
      await adminApi.verifyPart(draft.id, next);
      logActivity("human", `${next ? "Verified" : "Unverified"} ${draft.name}`, next ? "specs checked against the sources" : undefined);
      return `${draft.name} marked ${next ? "verified ✓" : "unverified"}`;
    });

  const discard = (draft: Part) => {
    if (!window.confirm(`Discard the draft for ${draft.name}? Published data is untouched.`)) return;
    run("discard", async () => {
      await adminApi.discardDraft(draft.id);
      logActivity("human", `Discarded draft · ${draft.name}`);
      setSelectedId(null);
      return `Draft discarded: ${draft.id}`;
    });
  };

  const publish = () => {
    const next = catalogVersion === null ? "the next version" : `catalog v${catalogVersion + 1}`;
    if (!window.confirm(`Publish ${publishableDrafts.length} draft(s) as ${next}? This is live for every shopper.`)) return;
    run("publish", async () => {
      const res = await adminApi.publish(viewerRole === "contributor" ? publishableDrafts.map((draft) => draft.id) : undefined, "human");
      setCatalogVersion(res.catalogVersion);
      logActivity("human", `Published catalog v${res.catalogVersion}`, `${res.published} part(s): ${res.partIds.join(", ")}`);
      setSelectedId(null);
      return `Published ${res.published} part(s) — catalog is now v${res.catalogVersion}`;
    });
  };

  const addPart = async (part: Record<string, unknown>) =>
    run("add part", async () => {
      const res = await adminApi.upsertDraft(part, "human");
      logActivity("human", `Added draft · ${String(part.name)}`, `${res.partId} · ${(part.sources as unknown[]).length} source(s) · unverified`);
      setAdding(false);
      setSelectedId(res.partId);
      return `Draft saved: ${res.partId}`;
    });

  const log = mergeLogs(serverLog, sessionLog, logFetchedAt);
  const draft = detail?.draft ?? null;
  const versionLabel = catalogVersion === null ? "v?" : `v${catalogVersion}`;
  const indexedSpecific = useMemo(() => new Set(cardAvailability && cardAvailability !== "error" ? cardAvailability.specificPartIds : []), [cardAvailability]);
  const indexedGeneric = useMemo(() => new Set(cardAvailability && cardAvailability !== "error" ? cardAvailability.genericArchetypes : []), [cardAvailability]);
  const cardKind = (part: Part): CardKind => {
    if (cardAvailability === null) return "loading";
    if (cardAvailability === "error") return "error";
    return resolveIndexedCardKind(part.id, genericCardArchetype(part), indexedSpecific, indexedGeneric);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-12 shrink-0 border-b border-seam bg-iron/80 flex items-center gap-4 px-4">
        <a href="/" className="font-display text-mark font-bold uppercase tracking-[0.06em] leading-none">
          RigBuilder
        </a>
        <span className="font-sans text-label font-semibold tracking-[0.02em] text-ember">Catalog</span>
        <span className="font-mono text-micro text-dust">back office · {versionLabel}{viewerIdentity ? ` · signed in as ${viewerIdentity}` : ""}{viewerRole ? ` · ${viewerRole}` : ""}</span>
        <span className="flex-1" />
        <WebMCPChip state={webmcp} toolCount={toolCount} scope="admin" onClick={() => setToolsOpen((open) => !open)} />
        {toolsOpen && <ToolsPopover tools={tools} onClose={() => setToolsOpen(false)} />}
        <Button size="sm" variant="primary" onClick={publish} disabled={publishableDrafts.length === 0 || busy || !!gate}>
          Publish {publishableDrafts.length > 0 && `(${publishableDrafts.length})`}
        </Button>
      </header>

      {toast && (
        <div
          role="status"
          className={`mx-4 mt-3 px-3 py-2 rounded-plate border font-mono text-spec animate-slide-in ${toast.tone === "ok" ? "border-clear text-clear bg-clear-dim" : "border-fault text-fault bg-fault-dim"}`}
        >
          {toast.text}
        </div>
      )}

      {gate ? (
        <GateNotice gate={gate} onRetry={refresh} />
      ) : (
        <>
        {viewerRole === "contributor" && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-plate border border-caution/50 bg-caution/5 font-mono text-spec text-caution">
            Contributor access · you can add and publish new parts. Existing catalog parts and verification are protected.
          </div>
        )}
        <div className="flex-1 min-h-0 p-4 grid gap-4 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col gap-4 min-h-0">
            {adding && (
              <Panel title="Add part" meta="👤 human · generated from the category schema" flush actions={<span className="font-mono text-micro text-dust">same validator as catalog_upsert_part</span>}>
                <AddPartForm onSubmit={addPart} onCancel={() => setAdding(false)} busy={busy} />
              </Panel>
            )}
            <Panel
              title="Catalog"
              meta={`${rows.length} of ${total}`}
              flush
              actions={
                <>
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search id, name, brand…" className={`${select} w-52 placeholder:text-dust`} />
                  <select value={cat} onChange={(e) => setCat(e.target.value as Category | "all")} className={select}>
                    <option value="all">all categories</option>
                    {SLOT_ORDER.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                  <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={select}>
                    <option value="all">published + draft</option>
                    <option value="published">published</option>
                    <option value="draft">draft</option>
                  </select>
                  <Button size="sm" onClick={() => setAdding((v) => !v)}>
                    {adding ? "Close form" : "Add part"}
                  </Button>
                </>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-spec">
                  <thead>
                    <tr className="text-left">
                      {["image", "id", "name", "brand", "price", "verified", "sources", "updated", "added by", "status"].map((h, i) => (
                        <th key={`${h}-${i}`} className={`eyebrow font-semibold px-3 py-2 border-b border-seam whitespace-nowrap ${h === "updated" ? "hidden xl:table-cell" : ""}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-seam">
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-3 py-6 text-center text-dust">
                          No parts match.
                        </td>
                      </tr>
                    )}
                    {rows.map((r) => (
                      <tr
                        key={`${r.id}-${r.status}`}
                        onClick={() => setSelectedId(r.id)}
                        className={`cursor-pointer hover:bg-plate/40 ${r.status === "draft" ? "bg-ember/5" : ""} ${selectedId === r.id ? "outline outline-1 -outline-offset-1 outline-seam-strong" : ""}`}
                      >
                        <td className="pl-3 pr-0 py-1.5">
                          <div className="flex items-center gap-2">
                            <PartThumbnail partId={r.id} category={r.category} fallback={genericCardArchetype(r)} size="table" />
                            <CardKindBadge kind={cardKind(r)} />
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-ash whitespace-nowrap">{r.id}</td>
                        <td className="px-3 py-2 font-sans text-label font-semibold whitespace-nowrap">{r.name}</td>
                        <td className="px-3 py-2 text-ash">{r.brand}</td>
                        <td className="px-3 py-2 font-mono tabular-nums whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <PriceCell value={r.priceUSD} disabled={busy || (viewerRole === "contributor" && publishedIds.has(r.id))} onCommit={(v) => setPrice(r, v)} />
                          <span className="ml-2 text-dust text-micro">{fmtDate(r.priceUpdatedAt)}</span>
                        </td>
                        <td className="px-3 py-2">{r.verified ? <Badge tone="verified">✓</Badge> : <span className="text-dust">—</span>}</td>
                        <td className="px-3 py-2 font-mono text-ash" title={r.sources.map((s) => s.url).join("\n")}>
                          {r.sources.length}
                        </td>
                        <td className="hidden xl:table-cell px-3 py-2 font-mono text-dust whitespace-nowrap">{fmtTime(r.updatedAt)}</td>
                        <td className="px-3 py-2">
                          <span className={`font-mono text-micro ${r.addedBy === "agent" ? "text-ember" : r.addedBy === "human" ? "text-glacier" : "text-dust"}`}>
                            {r.addedBy === "agent" ? "🤖 agent" : r.addedBy === "human" ? "👤 human" : "seed"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={r.status}>{r.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <div className="flex flex-col gap-4 min-h-0">
            <Panel
              title="Draft"
              meta={draft ? `${detail?.published ? "changed" : "new"} · ${draft.addedBy === "agent" ? "🤖 agent" : draft.addedBy === "human" ? "👤 human" : "seed"}${draft.verified ? " · ✓ verified" : ""}` : undefined}
              actions={
                draft && (
                  <>
                    <Button size="sm" variant={draft.verified ? "outline" : "primary"} disabled={busy || viewerRole !== "owner"} onClick={() => verify(draft)} title={viewerRole === "owner" ? "Human-only: marks the specs as checked against the sources" : "Verification is restricted to catalog owners"}>
                      {draft.verified ? "Unverify" : "Verify ✓"}
                    </Button>
                    <Button size="sm" variant="danger" disabled={busy || (viewerRole === "contributor" && !!detail?.published)} onClick={() => discard(draft)}>
                      Discard
                    </Button>
                  </>
                )
              }
            >
              {draft ? (
                <DraftView draft={draft} diff={detail?.diff ?? []} onSources={(urls) => setSources(draft, urls)} busy={busy} canEdit={viewerRole !== "contributor" || !detail?.published} />
              ) : detail?.published && selectedId ? (
                <p className="text-spec text-dust">
                  <span className="font-mono text-ash">{selectedId}</span> is published with no pending draft. Edit its price inline or ask your agent for an update.
                </p>
              ) : (
                <p className="text-spec text-dust">No drafts. Ask your agent to research a part, or add one by hand.</p>
              )}
            </Panel>
            <Panel title="Change log" meta={`${log.length} entries`} flush className="flex-1 min-h-0">
              <ul className="px-3 py-2 max-h-[50vh] overflow-y-auto">
                {log.length === 0 && <li className="py-2 text-spec text-dust">Nothing yet. Tool calls (🤖) and your actions (👤) show up here.</li>}
                {log.map((f) => (
                  <FeedRow key={f.id} item={f} />
                ))}
                {nextBefore && (
                  <li className="py-2">
                    <button onClick={() => loadLog(nextBefore)} className="font-mono text-micro text-glacier hover:underline">
                      load older
                    </button>
                  </li>
                )}
              </ul>
            </Panel>
          </div>
        </div>
        </>
      )}

      <footer className="shrink-0 border-t border-seam px-4 h-9 flex items-center gap-4">
        <span className="font-mono text-micro text-dust">catalog {versionLabel} · agents draft, humans verify and publish · gated by Cloudflare Access</span>
        <span className="flex-1" />
        <SystemStrip health={health} webmcp={webmcp} />
      </footer>
    </div>
  );
}

function CardKindBadge({ kind }: { kind: CardKind }) {
  if (kind === "loading") return <span className="font-mono text-micro text-dust">checking…</span>;
  if (kind === "specific") return <Badge tone="verified" title="Reviewed image generated specifically for this part">specific</Badge>;
  if (kind === "generic") return <Badge tone="info" title="Reviewed brand-free archetype; no part-specific image is indexed">generic</Badge>;
  if (kind === "none") return <Badge tone="warning" title="No reviewed specific image or generic fallback is indexed">none</Badge>;
  return <Badge tone="error" title="Image status could not be read from card storage">error</Badge>;
}

function PriceCell({ value, onCommit, disabled }: { value: number; onCommit: (v: number) => void; disabled?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (n !== value) onCommit(n);
  };
  return (
    <input
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(String(value));
      }}
      aria-label="price USD"
      className="w-16 bg-transparent border-b border-dashed border-seam-strong text-bone focus:border-glacier outline-none tabular-nums"
    />
  );
}

function DraftView({ draft, diff, onSources, busy, canEdit = true }: { draft: Part; diff: FieldDiff[]; onSources: (urls: string[]) => void; busy?: boolean; canEdit?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const isNew = diff.length === 1 && diff[0].field === "*";
  const fields = isNew
    ? Object.entries(draft)
        .filter(([k]) => !["id", "name", "brand", "category", "status", "verified", "addedBy", "updatedAt", "priceUpdatedAt", "sources"].includes(k))
        .map(([field, after]) => ({ field, before: undefined, after }))
    : diff.filter((d) => d.field !== "sources" && d.field !== "priceUpdatedAt");
  return (
    <>
      <div className="font-sans text-title font-semibold tracking-[-0.01em]">{draft.name}</div>
      <div className="font-mono text-micro text-dust">
        {draft.id} · {draft.brand} · {draft.category}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-spec max-h-64 overflow-y-auto">
        {fields.map((f) => (
          <div key={f.field} className="contents">
            <dt className="text-ash">{f.field}</dt>
            <dd className="tabular-nums break-all">
              {f.before !== undefined && f.before !== null && <span className="text-dust line-through mr-2">{fmtVal(f.before)}</span>}
              <span className="text-ember-glow">{fmtVal(f.after)}</span>
            </dd>
          </div>
        ))}
        {fields.length === 0 && <dd className="col-span-2 text-dust">No field changes.</dd>}
      </dl>
      <div className="mt-3 flex items-center gap-2">
        <span className="eyebrow">Sources · admin only</span>
        <span className="flex-1" />
        {canEdit && <button
          className="font-mono text-micro text-glacier hover:underline"
          onClick={() => {
            setText(draft.sources.map((s) => s.url).join("\n"));
            setEditing((v) => !v);
          }}
        >
          {editing ? "cancel" : "edit"}
        </button>}
      </div>
      {editing ? (
        <div className="mt-1">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="w-full bg-soot border border-seam rounded-chamfer px-2 py-1 font-mono text-spec text-bone outline-none focus:border-glacier" />
          <Button
            size="sm"
            className="mt-1"
            disabled={busy || !canEdit}
            onClick={() => {
              onSources(text.split(/\s+/).filter(Boolean));
              setEditing(false);
            }}
          >
            Save sources
          </Button>
        </div>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {draft.sources.length === 0 && <li className="font-mono text-spec text-caution">No sources recorded — add one before verifying.</li>}
          {draft.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer noopener" className="font-mono text-spec text-glacier hover:underline break-all">
                {s.title ?? s.url.replace(/^https:\/\//, "")} ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function GateNotice({ gate, onRetry }: { gate: NonNullable<Gate>; onRetry: () => void }) {
  const title = gate.kind === "unauthorized" ? "Sign in via Cloudflare Access" : gate.kind === "not-configured" ? "Admin API not configured" : "Backend unavailable";
  const hint =
    gate.kind === "unauthorized"
      ? "Your session has no valid Access token. Reload this page to go through the Access login, then come back."
      : gate.kind === "not-configured"
        ? "Set ACCESS_TEAM_DOMAIN and ACCESS_AUD on the Worker (or DEV_ADMIN_BYPASS=1 in .dev.vars for local dev)."
        : "The Worker did not answer. /admin needs the backend — the shopper page keeps working offline.";
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <Panel className="max-w-md w-full">
        <div className="font-sans text-title font-semibold tracking-[-0.01em]">{title}</div>
        <p className="mt-2 text-body text-ash">{hint}</p>
        <p className="mt-2 font-mono text-micro text-dust break-words">{gate.message}</p>
        <div className="mt-4 flex gap-2">
          {gate.kind === "unauthorized" ? (
            <Button size="sm" variant="primary" onClick={() => window.location.reload()}>
              Reload to sign in
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      </Panel>
    </div>
  );
}
