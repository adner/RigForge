import type { ReactNode } from "react";
import type { Severity } from "../types";

type Tone = Severity | "verified" | "count" | "draft" | "published";

const tones: Record<Tone, string> = {
  error: "bg-fault-dim text-fault",
  warning: "bg-caution-dim text-caution",
  info: "bg-plate text-ash",
  verified: "bg-clear-dim text-clear",
  count: "bg-ember text-soot",
  draft: "bg-ember-dim text-ember-glow",
  published: "bg-plate text-ash",
};

export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center h-4.5 px-1.5 rounded-chamfer font-mono text-micro uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export const SEVERITY_LABEL: Record<Severity, string> = { error: "Blocks", warning: "Check", info: "Note" };
