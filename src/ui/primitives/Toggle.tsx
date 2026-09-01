export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 select-none whitespace-nowrap" title={hint}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-4 w-8 shrink-0 rounded-chamfer border transition-colors duration-150 ${
          checked ? "bg-glacier-dim border-glacier" : "bg-steel border-seam-strong"
        }`}
      >
        <span
          className={`absolute left-0.5 top-1/2 size-2.5 -translate-y-1/2 rounded-[1px] transition-transform duration-150 ${
            checked ? "translate-x-4 bg-glacier" : "translate-x-0 bg-ash"
          }`}
        />
      </button>
      <span className="text-spec text-ash">{label}</span>
    </span>
  );
}
