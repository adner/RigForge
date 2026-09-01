import { useMemo, useState } from "react";
import { formFieldsFor, type FormField } from "../../admin/schema";
import { validateUpsertInput, type Issue } from "../../admin/validate";
import { Button } from "../primitives/Button";
import { Toggle } from "../primitives/Toggle";
import { type Category, CATEGORY_LABEL, SLOT_ORDER } from "../types";

const input = "h-7 w-full bg-soot border border-seam rounded-chamfer px-2 font-mono text-spec text-bone outline-none focus:border-glacier placeholder:text-dust";

/**
 * Add-part form generated from the category's zod schema (via JSON Schema): enums → selects,
 * numbers → number inputs with units inferred from the field name, booleans → toggles,
 * perfTier → a 1–10 grid. Validates with the same code path as `catalog_upsert_part`
 * and submits a draft with addedBy "human".
 */
export function AddPartForm({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (part: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [category, setCategory] = useState<Category>("gpu");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [sources, setSources] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const fields = useMemo(() => formFieldsFor(category), [category]);

  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));
  const issueFor = (key: string) => issues.find((i) => i.path === `part.${key}` || i.path.startsWith(`part.${key}.`))?.message;

  const submit = async () => {
    const part: Record<string, unknown> = { category };
    for (const f of fields) {
      const v = values[f.key];
      if (v === undefined || v === "") continue;
      part[f.key] = v;
    }
    const srcs = sources
      .split(/\s+/)
      .filter(Boolean)
      .map((url) => ({ url }));
    const v = validateUpsertInput({ part, sources: srcs });
    if (!v.ok) {
      setIssues(v.issues);
      setMessage(v.message);
      return;
    }
    setIssues([]);
    setMessage(null);
    await onSubmit(v.part);
  };

  return (
    <div className="p-3 space-y-3">
      <div className="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-2">
        <label className="eyebrow">category</label>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as Category);
            setValues({});
            setIssues([]);
          }}
          className={input}
        >
          {SLOT_ORDER.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        {fields.map((f) => (
          <Field key={f.key} field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} error={issueFor(f.key)} />
        ))}
        <label className="eyebrow self-start pt-1.5">sources</label>
        <div>
          <textarea
            value={sources}
            onChange={(e) => setSources(e.target.value)}
            rows={2}
            placeholder="https://… one URL per line (spec page you checked)"
            className={`${input} h-auto py-1`}
          />
          {issues.some((i) => i.path.startsWith("sources")) && <p className="mt-0.5 font-mono text-micro text-fault">{issues.find((i) => i.path.startsWith("sources"))?.message}</p>}
        </div>
      </div>
      {message && <p className="font-mono text-micro text-fault">{message}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={submit} disabled={busy}>
          Save draft
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <span className="flex-1" />
        <span className="font-mono text-micro text-dust">saved as draft · 👤 human · unverified until you tick ✓</span>
      </div>
    </div>
  );
}

function Field({ field: f, value, onChange, error }: { field: FormField; value: unknown; onChange: (v: unknown) => void; error?: string }) {
  const label = (
    <label className="eyebrow self-start pt-1.5 whitespace-nowrap" title={f.description}>
      {f.key}
      {f.unit && <span className="ml-1 normal-case tracking-normal text-dust">({f.unit})</span>}
      {f.required && <span className="text-ember"> *</span>}
    </label>
  );
  const err = error && <p className="mt-0.5 font-mono text-micro text-fault">{error}</p>;

  switch (f.kind) {
    case "boolean":
      return (
        <>
          {label}
          <div className="h-7 flex items-center">
            <Toggle checked={value === true} onChange={onChange} label={value === true ? "yes" : "no"} />
          </div>
        </>
      );
    case "enum":
      return (
        <>
          {label}
          <div>
            <select value={value === undefined ? "" : String(value)} onChange={(e) => onChange(coerce(f, e.target.value))} className={input}>
              <option value="">—</option>
              {f.options!.map((o) => (
                <option key={String(o)} value={String(o)}>
                  {String(o)}
                </option>
              ))}
            </select>
            {err}
          </div>
        </>
      );
    case "multi-enum": {
      const arr = Array.isArray(value) ? (value as (string | number)[]) : [];
      return (
        <>
          {label}
          <div>
            <div className="flex flex-wrap gap-1">
              {f.options!.map((o) => {
                const on = arr.includes(o);
                return (
                  <button
                    key={String(o)}
                    type="button"
                    onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])}
                    className={`h-6 px-2 rounded-chamfer border font-mono text-micro ${on ? "border-glacier text-glacier bg-glacier-dim" : "border-seam text-ash hover:border-seam-strong"}`}
                  >
                    {String(o)}
                  </button>
                );
              })}
            </div>
            {err}
          </div>
        </>
      );
    }
    case "perf": {
      const obj = (value ?? {}) as Record<string, number>;
      return (
        <>
          {label}
          <div>
            <div className="grid grid-cols-4 gap-x-2 gap-y-1">
              {f.options!.map((k) => (
                <label key={String(k)} className="flex items-center gap-1 font-mono text-micro text-ash">
                  <span className="w-20 truncate">{String(k)}</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={obj[String(k)] ?? ""}
                    onChange={(e) => onChange({ ...obj, [String(k)]: e.target.value === "" ? undefined : Number(e.target.value) })}
                    className={`${input} w-12 px-1`}
                  />
                </label>
              ))}
            </div>
            {err}
          </div>
        </>
      );
    }
    case "integer":
    case "number":
      return (
        <>
          {label}
          <div>
            <input
              type="number"
              step={f.kind === "integer" ? 1 : "any"}
              min={f.min}
              max={f.max}
              value={value === undefined ? "" : String(value)}
              onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
              placeholder={f.min !== undefined && f.max !== undefined ? `${f.min}–${f.max}` : undefined}
              className={input}
            />
            {err}
          </div>
        </>
      );
    default:
      return (
        <>
          {label}
          <div>
            <input value={typeof value === "string" ? value : ""} maxLength={f.max} onChange={(e) => onChange(e.target.value)} className={input} />
            {err}
          </div>
        </>
      );
  }
}

const coerce = (f: FormField, s: string): unknown => {
  if (s === "") return undefined;
  const numeric = f.options?.every((o) => typeof o === "number");
  return numeric ? Number(s) : s;
};
