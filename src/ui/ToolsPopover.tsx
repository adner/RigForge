import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface ToolListing {
  name: string;
  description: string;
}

/** Chip popover: the tools this page exposes (name + description). Never claims an agent is connected. */
export function ToolsPopover({ tools, onClose }: { tools: ToolListing[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Tools exposed by this page"
      className="fixed right-3 top-12 z-[100] w-[min(92vw,440px)] max-h-[70vh] overflow-y-auto bg-iron rounded-plate engraved border border-seam-strong p-3 animate-slide-in"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="eyebrow">WebMCP</span>
        <span className="spec">{tools.length} tools · document.modelContext</span>
        <span className="flex-1" />
        <button onClick={onClose} className="font-mono text-micro text-ash hover:text-bone">
          close
        </button>
      </div>
      <ul className="divide-y divide-seam">
        {tools.map((t) => (
          <li key={t.name} className="py-1.5">
            <div className="font-mono text-spec text-ember">{t.name}</div>
            <p className="text-spec text-ash mt-0.5">{t.description}</p>
          </li>
        ))}
        {tools.length === 0 && <li className="py-2 font-mono text-micro text-dust">No tools registered yet.</li>}
      </ul>
      <p className="mt-2 font-mono text-micro text-dust">Your agent discovers these by itself; this list is for you.</p>
    </div>,
    document.body,
  );
}
