/**
 * Analog-style power gauge. Sweep = 0 … scale, where scale = 1.25 × PSU (or a round number when no PSU).
 * Bands: green up to 80 % of PSU, amber 80–100 % (low headroom), red beyond PSU.
 */
const START = -120; // degrees from 12 o'clock; sweep 240° clockwise
const SWEEP = 240;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
}
function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

export function PowerGauge({ estWatts, psuWatts }: { estWatts: number; psuWatts?: number }) {
  const scale = psuWatts ? Math.ceil((psuWatts * 1.25) / 50) * 50 : Math.max(500, Math.ceil((estWatts * 1.5) / 100) * 100);
  const deg = (w: number) => START + SWEEP * Math.min(1, Math.max(0, w / scale));
  const cx = 80;
  const cy = 80;
  const r = 62;
  const headroom = psuWatts ? Math.round(((psuWatts - estWatts) / psuWatts) * 100) : undefined;
  const tone = !psuWatts ? "text-ash" : estWatts > psuWatts ? "text-fault" : headroom! < 20 ? "text-caution" : "text-clear";
  const ticks = Array.from({ length: 13 }, (_, i) => (i / 12) * scale);
  const limit = psuWatts ? { a: polar(cx, cy, r - 8, deg(psuWatts)), b: polar(cx, cy, r + 8, deg(psuWatts)) } : null;

  return (
    <div className="flex items-center gap-3">
      <svg
        viewBox="0 0 160 140"
        className="w-36 shrink-0"
        role="img"
        aria-label={`Estimated draw ${estWatts} W${psuWatts ? ` of ${psuWatts} W` : ""}`}
      >
        <path d={arc(cx, cy, r, START, START + SWEEP)} fill="none" stroke="var(--color-plate)" strokeWidth="8" />
        {psuWatts && limit && (
          <>
            <path d={arc(cx, cy, r, START, deg(psuWatts * 0.8))} fill="none" stroke="var(--color-clear-dim)" strokeWidth="8" />
            <path d={arc(cx, cy, r, deg(psuWatts * 0.8), deg(psuWatts))} fill="none" stroke="var(--color-caution-dim)" strokeWidth="8" />
            <path d={arc(cx, cy, r, deg(psuWatts), START + SWEEP)} fill="none" stroke="var(--color-fault-dim)" strokeWidth="8" />
            <line x1={limit.a[0]} y1={limit.a[1]} x2={limit.b[0]} y2={limit.b[1]} stroke="var(--color-bone)" strokeWidth="1.5" />
          </>
        )}
        {ticks.map((w, i) => {
          const major = i % 3 === 0;
          const [x1, y1] = polar(cx, cy, r - 10, deg(w));
          const [x2, y2] = polar(cx, cy, r - (major ? 16 : 13), deg(w));
          const [tx, ty] = polar(cx, cy, r - 25, deg(w));
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-ash)" strokeWidth={major ? 1.2 : 0.7} />
              {major && (
                <text
                  x={tx}
                  y={ty}
                  fill="var(--color-dust)"
                  fontSize="7"
                  fontFamily="var(--font-mono)"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {Math.round(w)}
                </text>
              )}
            </g>
          );
        })}
        <g
          style={{
            transform: `rotate(${deg(estWatts)}deg)`,
            transformOrigin: `${cx}px ${cy}px`,
            transition: "transform 300ms var(--ease-instrument)",
          }}
        >
          <polygon points={`${cx - 2},${cy} ${cx + 2},${cy} ${cx},${cy - r + 4}`} fill="var(--color-bone)" />
          <circle cx={cx} cy={cy} r="4" fill="var(--color-steel)" stroke="var(--color-bone)" strokeWidth="1.5" />
        </g>
        <text x={cx} y={cy + 34} fill="var(--color-dust)" fontSize="7" fontFamily="var(--font-mono)" textAnchor="middle" letterSpacing="1">
          WATTS · EST
        </text>
      </svg>
      <div className="min-w-0">
        <div className="eyebrow">Draw</div>
        <div className={`font-display text-gauge font-bold leading-none tabular-nums ${tone}`}>
          {estWatts}
          <span className="text-title text-ash ml-1">W</span>
        </div>
        <div className="mt-1 spec">
          {psuWatts ? (
            <>
              PSU {psuWatts} W · {headroom! >= 0 ? `${headroom}% headroom` : `${-headroom!}% over`}
            </>
          ) : (
            "no PSU yet"
          )}
        </div>
      </div>
    </div>
  );
}
