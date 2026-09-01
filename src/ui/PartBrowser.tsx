import { useEffect, useMemo, useState } from "react";
import { FORM_FACTORS, PSU_FORM_FACTORS, SOCKETS, type Part } from "../data/schema";
import { type Build, type CatalogIndex, type FitResult, type Goal, type RuleCode, fit, isMultiSlot, partsIn, utility } from "../engine";
import { Badge } from "./primitives/Badge";
import { Button } from "./primitives/Button";
import { Panel } from "./primitives/Panel";
import { PartThumbnail } from "./primitives/PartThumbnail";
import { Toggle } from "./primitives/Toggle";
import { humanizeRules, money, specLine } from "./partSpec";
import { type Category, CATEGORY_LABEL, SLOT_ORDER } from "./types";
import { genericCardArchetype } from "../engine/cardArchetype";

const PAGE = 60;
const FIT_TONE = { compatible: "text-clear", conditional: "text-caution", incompatible: "text-fault" } as const;
const FIT_LABEL = { compatible: "● fits", conditional: "◐ conditional", incompatible: "○ won't fit" } as const;

type Sort = "price-asc" | "price-desc" | "name" | "perf";

interface Filters {
  maxPrice?: number;
  socket?: string;
  formFactor?: string;
  ddrGen?: number;
  minLength?: number; // gpu: max length ≤ ; case: min GPU clearance ≥
  coolerType?: string;
  minWattage?: number;
  iface?: string;
}

/** Typed filter definitions per category — a sensible subset of the schema (DESIGN §7.2). */
function filterDefs(cat: Category): { key: keyof Filters; label: string; kind: "select" | "number"; options?: readonly (string | number)[]; unit?: string }[] {
  const price = { key: "maxPrice" as const, label: "≤ $", kind: "number" as const };
  switch (cat) {
    case "cpu":
      return [{ key: "socket", label: "socket", kind: "select", options: SOCKETS }, price];
    case "motherboard":
      return [
        { key: "socket", label: "socket", kind: "select", options: SOCKETS },
        { key: "formFactor", label: "form factor", kind: "select", options: FORM_FACTORS },
        { key: "ddrGen", label: "DDR", kind: "select", options: [4, 5] },
        price,
      ];
    case "ram":
      return [{ key: "ddrGen", label: "DDR", kind: "select", options: [4, 5] }, price];
    case "gpu":
      return [{ key: "minLength", label: "≤ length", kind: "number", unit: "mm" }, price];
    case "cooler":
      return [{ key: "coolerType", label: "type", kind: "select", options: ["air", "aio"] }, { key: "minLength", label: "≤ height", kind: "number", unit: "mm" }, price];
    case "case":
      return [
        { key: "formFactor", label: "fits", kind: "select", options: FORM_FACTORS },
        { key: "minLength", label: "GPU ≥", kind: "number", unit: "mm" },
        price,
      ];
    case "psu":
      return [{ key: "minWattage", label: "≥ W", kind: "number" }, { key: "formFactor", label: "form factor", kind: "select", options: PSU_FORM_FACTORS }, price];
    case "storage":
      return [{ key: "iface", label: "interface", kind: "select", options: ["m2-nvme", "sata"] }, price];
  }
}

function passes(p: Part, f: Filters): boolean {
  if (f.maxPrice !== undefined && p.priceUSD > f.maxPrice) return false;
  switch (p.category) {
    case "cpu":
      return !f.socket || p.socket === f.socket;
    case "motherboard":
      return (!f.socket || p.socket === f.socket) && (!f.formFactor || p.formFactor === f.formFactor) && (!f.ddrGen || p.ddrGen === f.ddrGen);
    case "ram":
      return !f.ddrGen || p.ddrGen === f.ddrGen;
    case "gpu":
      return f.minLength === undefined || p.lengthMm <= f.minLength;
    case "cooler":
      return (!f.coolerType || p.type === f.coolerType) && (f.minLength === undefined || p.type !== "air" || (p.heightMm ?? 0) <= f.minLength);
    case "case":
      return (!f.formFactor || p.formFactorSupport.includes(f.formFactor as (typeof FORM_FACTORS)[number])) && (f.minLength === undefined || p.maxGpuLengthMm >= f.minLength);
    case "psu":
      return (f.minWattage === undefined || p.wattage >= f.minWattage) && (!f.formFactor || p.formFactor === f.formFactor);
    case "storage":
      return !f.iface || p.interface === f.iface;
  }
}

/**
 * Two presentation softenings on top of the engine's tri-state fit (the engine stays the source of truth
 * for validation; this only decides what the *browser* hides):
 *  1. "X needs Y" rules fail as errors while slot Y is still empty (an F-series CPU with no GPU yet).
 *     For browsing that reads as "not yet checked", so they become conditional until the slot is filled.
 *  2. Errors the slot's *current* occupant already triggers (a 650 W PSU that is short for the build fails
 *     PSU_INSUFFICIENT for every CPU candidate) are not the candidate's doing: shown as conditional with an
 *     "already failing" note. A candidate that adds a *new* failing rule still reads "won't fit".
 */
const NEEDS_SLOT: Partial<Record<RuleCode, Category>> = { NO_IGPU_NO_GPU: "gpu", COOLER_MISSING: "cooler" };

const failingErrors = (r: FitResult) => r.checks.filter((c) => c.severity === "error" && c.result === "fail");

export function softenFit(r: FitResult, build: Build, occupantFit?: FitResult): FitResult & { inherited: RuleCode[] } {
  const inheritedCodes = new Set(occupantFit ? failingErrors(occupantFit).map((c) => c.code) : []);
  const soft = failingErrors(r).filter((c) => (NEEDS_SLOT[c.code] && partsIn(build, NEEDS_SLOT[c.code]!).length === 0) || inheritedCodes.has(c.code));
  // The engine already reports failures caused by *other* slots as `preexisting` (non-blocking); surface them as inherited too.
  if (!soft.length) return { ...r, inherited: [...r.preexisting] };
  const checks = r.checks.map((c) => (soft.includes(c) ? { ...c, result: "unknown" as const } : c));
  const inherited = [...new Set([...r.preexisting, ...soft.filter((c) => inheritedCodes.has(c.code)).map((c) => c.code)])];
  const pending = [...r.pending, ...soft.filter((c) => !inheritedCodes.has(c.code)).map((c) => c.code)];
  const blocked = checks.some((c) => c.severity === "error" && c.result === "fail" && !c.preexisting);
  return { fit: blocked ? "incompatible" : "conditional", checks, pending, preexisting: r.preexisting, inherited };
}

export interface PartBrowserProps {
  catalog: CatalogIndex;
  build: Build;
  goal?: Goal;
  tab: Category;
  onTab: (c: Category) => void;
  onlyCompatible: boolean;
  onOnlyCompatible: (v: boolean) => void;
  /** Called with the chosen part; the parent handles replace confirmation and the store write. */
  onAdd: (part: Part) => void;
  /** Bumped by the parent when it wants search/filters cleared (e.g. "fix" jump). */
  resetKey?: number;
}

export function PartBrowser({ catalog, build, goal, tab, onTab, onlyCompatible, onOnlyCompatible, onAdd, resetKey }: PartBrowserProps) {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [sort, setSort] = useState<Sort>("price-asc");
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    setFilters({});
    setQ("");
    setLimit(PAGE);
  }, [tab, resetKey]);

  const occupied = partsIn(build, tab);
  const slotFilled = occupied.length > 0;
  const multi = isMultiSlot(tab);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const occupant = partsIn(build, tab)[0];
    const occupantFit = occupant && !isMultiSlot(tab) ? fit(occupant, build, goal) : undefined;
    const list = catalog.byCategory[tab]
      .filter((p) => p.status !== "draft")
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.brand.toLowerCase().includes(needle))
      .filter((p) => passes(p, filters))
      .map((p) => ({ part: p as Part, fit: softenFit(fit(p as Part, build, goal), build, occupantFit) }));
    const cmp: Record<Sort, (a: { part: Part }, b: { part: Part }) => number> = {
      "price-asc": (a, b) => a.part.priceUSD - b.part.priceUSD,
      "price-desc": (a, b) => b.part.priceUSD - a.part.priceUSD,
      name: (a, b) => a.part.name.localeCompare(b.part.name),
      perf: (a, b) => utility(b.part, goal) - utility(a.part, goal) || a.part.priceUSD - b.part.priceUSD,
    };
    return list.sort(cmp[sort]);
  }, [catalog, tab, q, filters, sort, build, goal]);

  const visible = onlyCompatible ? rows.filter((r) => r.fit.fit !== "incompatible") : rows;
  const hidden = rows.length - visible.length;
  const page = visible.slice(0, limit);
  const defs = filterDefs(tab);

  const note = (r: FitResult & { inherited: RuleCode[] }): string | undefined => {
    if (r.fit === "conditional" && (r.pending.length || r.inherited.length)) {
      return [r.inherited.length && `already failing: ${humanizeRules(r.inherited)}`, r.pending.length && `not yet checked: ${humanizeRules(r.pending)}`].filter(Boolean).join(" · ");
    }
    if (r.fit === "incompatible") return r.checks.find((c) => c.severity === "error" && c.result === "fail")?.reason;
    const warn = r.checks.find((c) => c.severity === "warning" && c.result === "fail");
    return warn ? `check: ${warn.reason}` : undefined;
  };

  return (
    <Panel
      title="Parts"
      meta={`${visible.length} of ${catalog.byCategory[tab].length}`}
      flush
      className="flex-1"
      bodyClassName="flex flex-col overflow-hidden"
      actions={
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <Toggle checked={onlyCompatible} onChange={onOnlyCompatible} label="only compatible" hint="Hides parts the engine can already rule out against the current build" />
          {onlyCompatible && hidden > 0 && (
            <button onClick={() => onOnlyCompatible(false)} className="font-mono text-micro text-dust hover:text-bone">
              {hidden} hidden — show
            </button>
          )}
        </div>
      }
    >
      <div className="flex gap-0.5 px-2 pt-2 overflow-x-auto" role="tablist">
        {SLOT_ORDER.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={tab === c}
            onClick={() => onTab(c)}
            className={`h-7 px-2.5 rounded-chamfer font-sans tracking-[0.01em] text-spec font-semibold whitespace-nowrap ${
              tab === c ? "bg-plate text-bone" : "text-ash hover:text-bone"
            }`}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 px-3 py-2 border-b border-seam items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${CATEGORY_LABEL[tab].toLowerCase()} by name or brand…`}
          aria-label="Search parts"
          className="h-7 flex-1 min-w-40 bg-soot border border-seam rounded-chamfer px-2 font-mono text-spec text-bone placeholder:text-dust focus:border-glacier outline-none"
        />
        {defs.map((d) => (
          <label key={d.key} className="inline-flex items-center gap-1 font-mono text-micro text-ash">
            {d.label}
            {d.kind === "select" ? (
              <select
                value={filters[d.key] ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, [d.key]: e.target.value === "" ? undefined : d.key === "ddrGen" ? Number(e.target.value) : e.target.value }))}
                className="h-7 bg-soot border border-seam rounded-chamfer px-1 font-mono text-micro text-bone focus:border-glacier outline-none"
              >
                <option value="">any</option>
                {d.options!.map((o) => (
                  <option key={String(o)} value={String(o)}>
                    {String(o)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                inputMode="numeric"
                value={filters[d.key] ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, [d.key]: e.target.value === "" ? undefined : Number(e.target.value) }))}
                className="h-7 w-20 bg-soot border border-seam rounded-chamfer px-1.5 font-mono text-micro text-bone focus:border-glacier outline-none"
              />
            )}
            {d.unit && <span className="text-dust">{d.unit}</span>}
          </label>
        ))}
        <label className="inline-flex items-center gap-1 font-mono text-micro text-ash">
          sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-7 bg-soot border border-seam rounded-chamfer px-1 font-mono text-micro text-bone focus:border-glacier outline-none"
          >
            <option value="price-asc">price ↑</option>
            <option value="price-desc">price ↓</option>
            <option value="perf">best for goal</option>
            <option value="name">name</option>
          </select>
        </label>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto divide-y divide-seam">
        {page.map(({ part, fit: f }) => {
          const inBuild = occupied.some((p) => p.id === part.id);
          const n = note(f);
          return (
            <li
              key={part.id}
              className={`grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 items-center px-3 py-2 hover:bg-plate/40 ${f.fit === "incompatible" ? "opacity-50" : ""}`}
            >
              <PartThumbnail partId={part.id} category={part.category} fallback={genericCardArchetype(part)} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-sans text-label font-semibold tracking-[-0.01em] truncate">{part.name}</span>
                  <span className="spec">{part.brand}</span>
                  {part.verified && (
                    <Badge tone="verified" title="Specs verified by a human against the source">
                      ✓
                    </Badge>
                  )}
                  {inBuild && <Badge tone="info">in build</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 mt-0.5">
                  <span className="spec">{specLine(part)}</span>
                  <span className={`font-mono text-micro ${FIT_TONE[f.fit]}`}>{FIT_LABEL[f.fit]}</span>
                  {n && <span className="font-mono text-micro text-dust">{n}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-spec text-bone tabular-nums">{money(part.priceUSD)}</span>
                <Button
                  size="sm"
                  variant={f.fit === "incompatible" ? "danger" : "primary"}
                  disabled={inBuild}
                  onClick={() => onAdd(part)}
                  title={f.fit === "incompatible" ? `${n ?? "This part conflicts with the current build"}. Review blockers before continuing.` : undefined}
                >
                  {f.fit === "incompatible" ? (slotFilled && !multi ? "Swap anyway" : "Add anyway") : slotFilled && !multi ? "Swap in" : "Add"}
                </Button>
              </div>
            </li>
          );
        })}
        {page.length === 0 && (
          <li className="px-3 py-6 text-center font-mono text-micro text-dust">
            {rows.length === 0 ? "No parts match the search and filters." : `All ${hidden} matching parts are ruled out by the current build.`}
          </li>
        )}
      </ul>
      {visible.length > limit && (
        <div className="px-3 py-2 border-t border-seam flex items-center gap-3">
          <span className="font-mono text-micro text-dust">
            showing {limit} of {visible.length}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, visible.length - limit)} more
          </Button>
        </div>
      )}
    </Panel>
  );
}
