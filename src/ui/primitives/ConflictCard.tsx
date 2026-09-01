import { type Conflict, CATEGORY_LABEL } from "../types";
import { Badge, SEVERITY_LABEL } from "./Badge";

const edge = { error: "border-l-fault", warning: "border-l-caution", info: "border-l-seam-strong" } as const;

export function ConflictCard({ conflict, onFix }: { conflict: Conflict; onFix?: (c: Conflict) => void }) {
  return (
    <article className={`rounded-plate border border-seam border-l-2 ${edge[conflict.severity]} bg-steel/40 px-2.5 py-2 animate-slide-in`}>
      <div className="flex items-center gap-2">
        <Badge tone={conflict.severity}>{SEVERITY_LABEL[conflict.severity]}</Badge>
        <span className="font-mono text-micro text-dust">{conflict.code}</span>
        <span className="flex-1" />
        <span className="font-mono text-micro text-ash">{conflict.slots.map((s) => CATEGORY_LABEL[s]).join(" ↔ ")}</span>
      </div>
      <p className="mt-1.5 text-body text-bone/90">{conflict.explanation}</p>
      {onFix && conflict.severity !== "info" && (
        <button onClick={() => onFix(conflict)} className="mt-1.5 font-mono text-micro text-glacier hover:underline">
          show parts that fix this →
        </button>
      )}
    </article>
  );
}
