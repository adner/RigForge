import type { ReactNode } from "react";

type Tone = "neutral" | "ember" | "glacier" | "clear" | "fault";

const tones: Record<Tone, string> = {
  neutral: "border-seam-strong text-ash",
  ember: "border-ember text-ember",
  glacier: "border-glacier text-glacier",
  clear: "border-clear text-clear",
  fault: "border-fault text-fault",
};

export function Chip({
  tone = "neutral",
  dot,
  children,
  onClick,
  title,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  const cls = `inline-flex items-center gap-2 h-7 px-2.5 rounded-chamfer border bg-iron/60 font-mono text-spec whitespace-nowrap ${tones[tone]}`;
  const inner = (
    <>
      {dot && <span className="size-1.5 rounded-full bg-current shadow-[0_0_6px_currentColor]" />}
      {children}
    </>
  );
  return onClick ? (
    <button onClick={onClick} title={title} className={`${cls} hover:bg-plate`}>
      {inner}
    </button>
  ) : (
    <span title={title} className={cls}>
      {inner}
    </span>
  );
}

/** §3.4 — the chip never claims an agent is connected. */
export function WebMCPChip({
  state,
  toolCount,
  scope = "shopper",
  onClick,
}: {
  state: "detecting" | "present" | "absent";
  toolCount: number;
  scope?: "shopper" | "admin";
  onClick?: () => void;
}) {
  if (state === "detecting") return <Chip>WebMCP · detecting…</Chip>;
  if (state === "absent") return <Chip tone="neutral">WebMCP not detected — open in ChatGPT's browser or Chrome 149+</Chip>;
  const noun = scope === "admin" ? "catalog tools" : "tools";
  return (
    <Chip tone="ember" dot onClick={onClick} title="List the tools this page exposes">
      WebMCP · {toolCount} {noun} exposed to your agent
    </Chip>
  );
}
