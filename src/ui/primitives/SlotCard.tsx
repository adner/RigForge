import { type Actor, type Category, CATEGORY_LABEL, type SlotPart } from "../types";
import { Badge } from "./Badge";
import { PartThumbnail } from "./PartThumbnail";

/** One build slot. `flash` replays the provenance animation whenever `flashKey` changes. */
export function SlotCard({
  category,
  part,
  extraCount = 0,
  flash,
  flashKey,
  attention,
  onFill,
  onSwap,
  onRemove,
  compact,
}: {
  category: Category;
  part?: SlotPart;
  /** Multi-slot categories: how many more parts sit behind the first one. */
  extraCount?: number;
  flash?: Actor | null;
  flashKey?: number;
  /** A conflict points here. */
  attention?: "error" | "warning";
  onFill?: () => void;
  onSwap?: () => void;
  onRemove?: () => void;
  /** Rail mode (narrow layout). */
  compact?: boolean;
}) {
  const flashClass = flash === "agent" ? "animate-flash-ember" : flash === "human" ? "animate-flash-glacier" : "";
  const edge =
    attention === "error"
      ? "border-l-fault"
      : attention === "warning"
        ? "border-l-caution"
        : part
          ? "border-l-seam-strong"
          : "border-l-transparent";

  return (
    <article
      key={flashKey}
      className={`group relative rounded-plate border border-seam border-l-2 ${edge} bg-steel/60 ${flashClass} ${
        compact ? "w-44 shrink-0 snap-start" : ""
      } ${part ? "" : "border-dashed"}`}
    >
      <div className="px-2.5 pt-1.5 pb-1.5">
        <div className="flex items-center gap-2">
          <span className="eyebrow">{CATEGORY_LABEL[category]}</span>
          {extraCount > 0 && <span className="spec">+{extraCount}</span>}
          <span className="flex-1" />
          {part?.verified && (
            <Badge tone="verified" title="Specs verified by a human against the source">
              ✓
            </Badge>
          )}
        </div>
        {part ? (
          <div className="mt-1 flex min-w-0 gap-2">
            <PartThumbnail partId={part.id} category={category} fallback={part.thumbnailFallback} size="slot" eager />
            <div className="min-w-0 flex-1">
              <div className={`font-sans font-semibold tracking-[-0.01em] leading-tight truncate ${compact ? "text-label" : "text-[1.05rem]"}`}>{part.name}</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="spec truncate">{part.spec}</span>
                <span className="flex-1" />
                <span className="font-mono text-spec text-bone tabular-nums">${part.priceUSD.toLocaleString()}</span>
              </div>
              {(onSwap || onRemove) && (
                <div
                  className={`mt-1 flex gap-1 transition-opacity duration-150 [@media(hover:none)]:opacity-100 ${
                    compact ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                  }`}
                >
                  {onSwap && (
                    <button onClick={onSwap} className="font-mono text-micro text-glacier hover:underline focus-visible:underline" aria-label={`Swap ${CATEGORY_LABEL[category]}`}>
                      swap
                    </button>
                  )}
                  {onSwap && onRemove && <span className="text-dust text-micro">·</span>}
                  {onRemove && (
                    <button onClick={onRemove} className="font-mono text-micro text-ash hover:text-fault hover:underline focus-visible:underline" aria-label={`Remove ${CATEGORY_LABEL[category]}`}>
                      remove
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <button onClick={onFill} className="mt-1 block text-left w-full">
            <span className="font-sans text-label font-medium text-dust leading-none">Empty</span>
            <span className="block mt-1 text-micro text-dust font-mono">choose a {CATEGORY_LABEL[category].toLowerCase()} →</span>
          </button>
        )}
      </div>
    </article>
  );
}
