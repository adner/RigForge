/**
 * JSON Schema per category, generated client-side from the frozen zod schemas — the same
 * call the Worker's GET /api/admin/schema/:category makes, so tools answer without a round-trip.
 */
import { z } from "zod";
import { schemaByCategory, type Category } from "../data/schema";

const cache = new Map<Category, Record<string, unknown>>();

export const jsonSchemaFor = (category: Category): Record<string, unknown> => {
  let s = cache.get(category);
  if (!s) {
    s = z.toJSONSchema(schemaByCategory[category], { unrepresentable: "any", io: "input" }) as Record<string, unknown>;
    cache.set(category, s);
  }
  return s;
};

/** Flattened field descriptor for the admin Add-part form (derived from the JSON Schema). */
export interface FormField {
  key: string;
  kind: "string" | "number" | "integer" | "boolean" | "enum" | "multi-enum" | "perf";
  required: boolean;
  options?: (string | number)[];
  min?: number;
  max?: number;
  unit?: string;
  description?: string;
}

/** Server-controlled or form-managed fields the generated form must not render. */
const HIDDEN = new Set(["id", "category", "verified", "status", "addedBy", "updatedAt", "priceUpdatedAt", "sources"]);

const unitOf = (key: string): string | undefined => {
  if (/Mm$/.test(key)) return "mm";
  if (/W$/.test(key) || key === "wattage") return "W";
  if (/MHz$/.test(key)) return "MHz";
  if (/GB$/.test(key)) return "GB";
  if (/USD$/.test(key)) return "USD";
  if (/Liters$/.test(key)) return "L";
  return undefined;
};

type JS = Record<string, unknown>;

const enumOf = (s: JS): (string | number)[] | undefined => {
  if (Array.isArray(s.enum)) return s.enum as (string | number)[];
  if (s.const !== undefined) return [s.const as string | number];
  const anyOf = (s.anyOf ?? s.oneOf) as JS[] | undefined;
  if (anyOf && anyOf.every((a) => a.const !== undefined || Array.isArray(a.enum))) return anyOf.flatMap((a) => (a.const !== undefined ? [a.const as string | number] : (a.enum as (string | number)[])));
  return undefined;
};

export function formFieldsFor(category: Category): FormField[] {
  const schema = jsonSchemaFor(category);
  const props = (schema.properties ?? {}) as Record<string, JS>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const out: FormField[] = [];
  for (const [key, raw] of Object.entries(props)) {
    if (HIDDEN.has(key)) continue;
    let s = raw;
    // optional fields come out as anyOf [X, null] or with `default`; unwrap
    const anyOf = s.anyOf as JS[] | undefined;
    if (anyOf && anyOf.length === 2 && anyOf.some((a) => a.type === "null")) s = anyOf.find((a) => a.type !== "null")!;
    const base: FormField = { key, kind: "string", required: required.has(key), unit: unitOf(key), description: s.description as string | undefined };
    if (key === "perfTier") out.push({ ...base, kind: "perf", options: Object.keys((s.properties ?? {}) as JS) });
    else if (s.type === "boolean") out.push({ ...base, kind: "boolean" });
    else if (s.type === "array") {
      const items = (s.items ?? {}) as JS;
      out.push({ ...base, kind: "multi-enum", options: enumOf(items) ?? [] });
    } else {
      const opts = enumOf(s);
      if (opts) out.push({ ...base, kind: "enum", options: opts });
      else if (s.type === "integer" || s.type === "number")
        out.push({ ...base, kind: s.type as "integer" | "number", min: (s.minimum ?? s.exclusiveMinimum) as number | undefined, max: s.maximum as number | undefined });
      else out.push({ ...base, kind: "string", max: s.maxLength as number | undefined });
    }
  }
  return out;
}
