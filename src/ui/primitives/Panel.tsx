import type { ReactNode } from "react";

export function Panel({
  title,
  meta,
  actions,
  children,
  className = "",
  bodyClassName = "",
  flush,
}: {
  title?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** No inner padding (tables, lists). */
  flush?: boolean;
}) {
  return (
    <section className={`bg-iron rounded-plate engraved flex flex-col min-h-0 ${className}`}>
      {(title || actions) && (
        <header className="flex min-h-9 items-center gap-3 border-b border-seam px-3 py-1.5 shrink-0">
          {title && <h2 className="eyebrow">{title}</h2>}
          {meta && <span className="spec whitespace-nowrap">{meta}</span>}
          <span className="flex-1" />
          {actions}
        </header>
      )}
      <div className={`${flush ? "" : "p-3"} min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
