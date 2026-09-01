import type { FeedItem } from "../types";

/** Activity feed row. Left rule encodes provenance: ember = agent, glacier = human. */
export function FeedRow({ item, onUndo }: { item: FeedItem; onUndo?: (id: string) => void }) {
  const agent = item.actor === "agent";
  return (
    <li className={`relative min-w-0 pl-3 py-2 border-l-2 ${agent ? "border-ember" : "border-glacier"} animate-slide-in`}>
      <div className="flex min-w-0 items-center gap-2 font-mono text-micro text-dust tabular-nums">
        <span className="text-spec leading-none" aria-label={agent ? "agent" : "you"}>
          {agent ? "🤖" : "👤"}
        </span>
        <time className="font-semibold text-ash">{item.time}</time>
        <span className="flex-1" />
        {item.revision !== undefined && <span className="font-mono text-micro text-dust shrink-0">rev {item.revision}</span>}
      </div>
      <p className="mt-1 min-w-0 text-body font-semibold leading-snug text-bone break-words">{item.title}</p>
      {item.detail && <p className="mt-0.5 text-spec leading-relaxed text-ash break-words">{item.detail}</p>}
      {item.undo === "available" && (
        <button onClick={() => onUndo?.(item.id)} className="mt-0.5 font-mono text-micro text-glacier hover:underline">
          undo
        </button>
      )}
      {item.undo === "superseded" && (
        <span
          className="mt-0.5 inline-block font-mono text-micro text-dust line-through decoration-dust/60"
          title="A later change touched this slot; undo no longer applies."
        >
          undo · superseded
        </span>
      )}
    </li>
  );
}
