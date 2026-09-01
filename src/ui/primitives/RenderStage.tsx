import { useState, type ComponentProps } from "react";
import { CaseSilhouette } from "./CaseSilhouette";

export interface RenderArtifact {
  renderId: string;
  forBuildRevision: number;
  imageUrl: string;
  status: "active" | "superseded" | "pending" | "failed";
  cached?: boolean;
}

/** The center stage: schematic by default; an active render replaces it with a reveal. Superseded renders go to a strip. */
export function RenderStage({
  active,
  superseded = [],
  pending,
  silhouette,
  buildRevision,
  showSchematic,
  onShowSchematic,
  onRender,
  onRemoveRender,
  canRender,
  onVerify,
  needsVerify,
  caption,
}: {
  active?: RenderArtifact | null;
  superseded?: RenderArtifact[];
  /** A render request is in flight. */
  pending?: boolean;
  silhouette: ComponentProps<typeof CaseSilhouette>;
  buildRevision: number;
  /** Force the schematic even when an active render exists. */
  showSchematic?: boolean;
  onShowSchematic?: (show: boolean) => void;
  /** Human render button (glacier). Hidden when undefined. */
  onRender?: () => void;
  /** Removes a render artifact from this browser's build history. */
  onRemoveRender?: (renderId: string) => void;
  canRender?: boolean;
  onVerify?: () => void;
  needsVerify?: boolean;
  /** Product names for the caption (the prompt itself never carries them). */
  caption?: string;
}) {
  const showImage = !!active && !showSchematic;
  const [assemblyView, setAssemblyView] = useState<"side" | "footprint">("side");
  return (
    <div className="flex flex-col min-h-0">
      <div className="relative bg-iron rounded-plate border border-seam overflow-hidden aspect-[4/3] max-h-[40vh] lg:max-h-[52vh] flex items-center justify-center engraved">
        {showImage ? (
          <img key={active.renderId} src={active.imageUrl} alt="AI impression of this build" className="h-full w-full object-contain animate-reveal" />
        ) : (
          <CaseSilhouette {...silhouette} view={assemblyView} className="h-full w-auto max-w-full p-2" />
        )}
        <div className="absolute left-2 top-2 font-mono text-micro text-dust">rev {buildRevision}</div>
        {!showImage && (
          <div className="absolute left-1/2 -translate-x-1/2 top-2 flex items-center rounded-chamfer border border-seam bg-iron/90 p-0.5 shadow-sm" aria-label="Assembly view">
            {(["side", "footprint"] as const).map((next) => (
              <button
                key={next}
                onClick={() => setAssemblyView(next)}
                aria-pressed={assemblyView === next}
                className={`h-6 px-2 rounded-[3px] font-sans text-micro font-semibold transition-colors ${assemblyView === next ? "bg-bone text-iron" : "text-ash hover:text-bone"}`}
              >
                {next === "side" ? "Assembly" : "Footprint"}
              </button>
            ))}
          </div>
        )}
        {active && (
          <button
            onClick={() => onShowSchematic?.(!showSchematic)}
            className="absolute right-2 top-2 font-mono text-micro text-ash hover:text-bone bg-iron/90 border border-seam px-1.5 h-6 rounded-chamfer"
          >
            {showSchematic ? "render" : "schematic"}
          </button>
        )}
        {pending && (
          <div className="absolute inset-0 bg-iron/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2" role="status" aria-live="polite">
            <span className="size-6 rounded-full border-2 border-seam-strong border-t-bone animate-spin" />
            <span className="font-mono text-micro text-ash">rendering… 10–40 s</span>
          </div>
        )}
        <div className="absolute bottom-2 right-2 flex items-center gap-2">
          {needsVerify && !pending && (
            <button
              onClick={onVerify}
              className="h-7 px-2.5 rounded-chamfer bg-glacier text-white font-sans text-spec font-semibold"
              title="Prove you're human once; then renders work for an hour"
            >
              Verify to render
            </button>
          )}
          {onRender && !needsVerify && !pending && (
            <button
              onClick={onRender}
              disabled={!canRender}
              className="h-7 px-2.5 rounded-chamfer border border-seam-strong bg-iron/90 text-bone hover:border-glacier hover:text-glacier disabled:opacity-40 font-sans text-spec font-semibold"
              title={canRender ? "AI impression of this build (brand-free, from its attributes)" : "Add a case first"}
            >
              Render
            </button>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex min-w-0 items-start gap-2">
        <p className="min-w-0 flex-1 font-mono text-micro text-dust break-words">
          {showImage
            ? `AI impression${active.cached ? " (cached)" : ""} — not to scale · brand-free, derived from the build's attributes${caption ? ` · ${caption}` : ""}`
            : "Modeled components to scale · representative case shell"}
        </p>
        {active && (
          <button
            onClick={() => onRemoveRender?.(active.renderId)}
            className="shrink-0 font-mono text-micro text-fault hover:underline"
            title="Remove this rendered image from the build"
          >
            Remove render
          </button>
        )}
      </div>
      {superseded.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {superseded.map((r) => (
            <figure key={r.renderId} className="relative shrink-0 w-20 pr-0.5">
              <img src={r.imageUrl} alt="" className="h-14 w-20 object-cover rounded-chamfer border border-seam opacity-60" />
              <button
                onClick={() => onRemoveRender?.(r.renderId)}
                className="absolute right-1 top-1 size-5 rounded-chamfer border border-seam-strong bg-iron/95 text-fault font-sans text-label leading-none shadow-sm hover:border-fault"
                aria-label={`Remove rendered build from revision ${r.forBuildRevision}`}
                title="Remove this rendered image"
              >
                ×
              </button>
              <figcaption className="font-mono text-micro text-dust mt-0.5 leading-tight">rev {r.forBuildRevision}<br />superseded</figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
