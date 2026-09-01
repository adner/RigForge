import { useState } from "react";
import { WORKLOADS } from "../data/schema";
import type { Goal } from "../engine";
import { Button } from "./primitives/Button";
import { money } from "./partSpec";

const WORKLOAD_LABEL: Record<Goal["useCase"], string> = {
  gaming: "Gaming",
  streaming: "Streaming",
  "video-editing": "Video editing",
  "3d-rendering": "3D rendering",
  ml: "Machine learning",
  office: "Office",
};

export function goalSummary(goal?: Goal): string {
  if (!goal) return "No goal set";
  const bits = [WORKLOAD_LABEL[goal.useCase], money(goal.budgetUSD)];
  const p = goal.preferences;
  if (p?.noise === "quiet") bits.push("quiet");
  if (p?.size && p.size !== "any") bits.push(p.size);
  if (p?.lighting && p.lighting !== "any") bits.push(p.lighting === "rgb" ? "RGB" : "no RGB");
  if (p?.color && p.color !== "any") bits.push(p.color);
  return bits.join(" · ");
}

const sel = "h-7 bg-soot border border-seam rounded-chamfer px-1 font-mono text-micro text-bone focus:border-glacier outline-none";

/** Goal banner with an inline editor (use case, budget, preference enums) → onSave (a human action). */
export function GoalBanner({ goal, onSave }: { goal?: Goal; onSave: (g: Goal) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Goal>(() => goal ?? { useCase: "gaming", budgetUSD: 1500, preferences: {} });

  if (!editing) {
    return (
      <div className="rounded-plate border border-seam bg-iron/60 px-3 py-2 flex items-center gap-3">
        <span className="eyebrow">Goal</span>
        <span className={`text-spec truncate ${goal ? "text-bone" : "text-dust"}`}>{goalSummary(goal)}</span>
        <span className="flex-1" />
        <button
          onClick={() => {
            setDraft(goal ?? { useCase: "gaming", budgetUSD: 1500, preferences: {} });
            setEditing(true);
          }}
          className="font-mono text-micro text-glacier hover:underline"
        >
          {goal ? "edit" : "set"}
        </button>
      </div>
    );
  }

  const pref = <K extends keyof NonNullable<Goal["preferences"]>>(k: K, v: string) =>
    setDraft((d) => ({ ...d, preferences: { ...d.preferences, [k]: v === "" ? undefined : v } }));

  return (
    <form
      className="rounded-plate border border-glacier/40 bg-iron/60 px-3 py-2 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!(draft.budgetUSD > 0)) return;
        onSave(draft);
        setEditing(false);
      }}
    >
      <div className="flex items-center gap-2">
        <span className="eyebrow">Goal</span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit">
          Save
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 font-mono text-micro text-ash">
        <label className="flex flex-col gap-0.5">
          use case
          <select className={sel} value={draft.useCase} onChange={(e) => setDraft((d) => ({ ...d, useCase: e.target.value as Goal["useCase"] }))}>
            {WORKLOADS.map((w) => (
              <option key={w} value={w}>
                {WORKLOAD_LABEL[w]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          budget USD
          <input
            type="number"
            min={100}
            step={50}
            className={sel}
            value={draft.budgetUSD}
            onChange={(e) => setDraft((d) => ({ ...d, budgetUSD: Number(e.target.value) }))}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          noise
          <select className={sel} value={draft.preferences?.noise ?? ""} onChange={(e) => pref("noise", e.target.value)}>
            <option value="">any</option>
            <option value="quiet">quiet</option>
            <option value="standard">standard</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          size
          <select className={sel} value={draft.preferences?.size ?? ""} onChange={(e) => pref("size", e.target.value)}>
            <option value="">any</option>
            <option value="compact">compact</option>
            <option value="standard">standard</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          lighting
          <select className={sel} value={draft.preferences?.lighting ?? ""} onChange={(e) => pref("lighting", e.target.value)}>
            <option value="">any</option>
            <option value="rgb">RGB</option>
            <option value="none">none</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          colour
          <select className={sel} value={draft.preferences?.color ?? ""} onChange={(e) => pref("color", e.target.value)}>
            <option value="">any</option>
            <option value="black">black</option>
            <option value="white">white</option>
          </select>
        </label>
      </div>
    </form>
  );
}
