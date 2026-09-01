/** Running total with optional budget. Digits are tabular so the ticker doesn't jitter. */
export function PriceTicker({ total, budget }: { total: number; budget?: number }) {
  const over = budget !== undefined && total > budget;
  const pct = budget ? Math.min(100, (total / budget) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="eyebrow">Total</span>
        <span className="flex-1" />
        <span
          key={total}
          className={`font-display text-gauge font-bold tabular-nums leading-none animate-slide-in ${over ? "text-caution" : "text-bone"}`}
        >
          <span className="text-ash text-title align-top mr-0.5">$</span>
          {total.toLocaleString()}
        </span>
      </div>
      {budget !== undefined && (
        <div className="mt-1.5">
          <div className="h-1 bg-plate rounded-chamfer overflow-hidden">
            <div className={`h-full transition-[width] duration-300 ${over ? "bg-caution" : "bg-ash"}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-micro text-dust">
            <span>{over ? `over by $${(total - budget).toLocaleString()}` : `$${(budget - total).toLocaleString()} left`}</span>
            <span>budget ${budget.toLocaleString()}</span>
          </div>
        </div>
      )}
      <p className="mt-1 font-mono text-micro text-dust">indicative USD · snapshot 2026-08</p>
    </div>
  );
}
