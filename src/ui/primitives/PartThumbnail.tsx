import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GenericCardArchetype } from "../../engine/cardArchetype";
import { cardThumbnailUrl } from "../../catalog/cardImages";
import type { Category } from "../types";

const FALLBACK_MARK: Record<Category, string> = {
  cpu: "CPU",
  motherboard: "MB",
  ram: "RAM",
  gpu: "GPU",
  cooler: "CL",
  case: "CASE",
  psu: "PSU",
  storage: "SSD",
};

type PreviewPosition = { left: number; top: number; width: number };

const PREVIEW_SIZE = 224;
const PREVIEW_GUTTER = 12;
const PREVIEW_GAP = 10;

/** A compact inspection-window treatment for generated, brand-free part illustrations. */
export function PartThumbnail({
  partId,
  category,
  fallback,
  size = "row",
  eager = false,
}: {
  partId: string;
  category: Category;
  fallback: GenericCardArchetype;
  size?: "table" | "row" | "slot";
  eager?: boolean;
}) {
  const src = cardThumbnailUrl(partId, fallback);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPosition, setPreviewPosition] = useState<PreviewPosition | null>(null);
  const thumbnailRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
    setPreviewOpen(false);
  }, [src]);

  const positionPreview = useCallback(() => {
    const rect = thumbnailRef.current?.getBoundingClientRect();
    if (!rect || rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
      setPreviewOpen(false);
      return;
    }

    const width = Math.min(PREVIEW_SIZE, Math.max(144, window.innerWidth - PREVIEW_GUTTER * 2));
    // The caption takes a little vertical room in addition to the square image.
    const height = width + 28;
    const roomBelow = window.innerHeight - rect.bottom;
    const roomAbove = rect.top;
    const top =
      roomBelow >= height + PREVIEW_GAP || roomBelow >= roomAbove
        ? Math.min(rect.bottom + PREVIEW_GAP, window.innerHeight - height - PREVIEW_GUTTER)
        : Math.max(PREVIEW_GUTTER, rect.top - height - PREVIEW_GAP);
    const left = Math.min(
      Math.max(PREVIEW_GUTTER, rect.left + rect.width / 2 - width / 2),
      window.innerWidth - width - PREVIEW_GUTTER,
    );
    setPreviewPosition({ left, top, width });
  }, []);

  useLayoutEffect(() => {
    if (!previewOpen) return;
    positionPreview();
    window.addEventListener("resize", positionPreview);
    // Capture catches scrolling inside the browser and admin table containers too.
    window.addEventListener("scroll", positionPreview, true);
    return () => {
      window.removeEventListener("resize", positionPreview);
      window.removeEventListener("scroll", positionPreview, true);
    };
  }, [positionPreview, previewOpen]);

  const dimensions = size === "table" ? "size-9" : size === "slot" ? "size-12" : "size-11";
  const canPreview = loaded && !failed;

  const openPreview = () => {
    if (canPreview) setPreviewOpen(true);
  };

  const closePreview = () => setPreviewOpen(false);

  return (
    <>
      <span
        ref={thumbnailRef}
        className={`${dimensions} relative inline-grid shrink-0 overflow-hidden rounded-chamfer border border-seam-strong bg-bone/90 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glacier`}
        title={canPreview ? "Brand-free generated illustration — hover or focus to enlarge" : "Brand-free generated illustration"}
        tabIndex={canPreview ? 0 : -1}
        role={canPreview ? "img" : undefined}
        aria-label={canPreview ? "Brand-free generated illustration. Focus to preview larger." : undefined}
        onPointerEnter={openPreview}
        onPointerLeave={closePreview}
        onFocus={openPreview}
        onBlur={closePreview}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            closePreview();
            event.currentTarget.blur();
          }
        }}
      >
        {!failed ? (
          <img
            src={src}
            alt=""
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => {
              setFailed(true);
              setLoaded(false);
              closePreview();
            }}
            className="size-full object-cover"
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center bg-[linear-gradient(135deg,rgba(255,255,255,.22),transparent_55%)] font-mono text-[8px] font-bold tracking-[0.08em] text-soot/55">
            {FALLBACK_MARK[category]}
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 h-px bg-glacier/45" />
      </span>
      {previewOpen && previewPosition && typeof document !== "undefined"
        ? createPortal(
            <figure
              className="pointer-events-none fixed z-[70] overflow-hidden rounded-plate border border-seam-strong bg-iron shadow-[0_18px_48px_rgba(0,0,0,0.42)]"
              style={{ left: previewPosition.left, top: previewPosition.top, width: previewPosition.width }}
              aria-hidden="true"
            >
              <img src={src} alt="" className="block aspect-square w-full object-cover" />
              <figcaption className="border-t border-seam bg-steel/95 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-ash">
                generated illustration
              </figcaption>
            </figure>,
            document.body,
          )
        : null}
    </>
  );
}
