/** Shared prop types for the UI layer. Kept dependency-free so the store wiring can map onto them. */
export type Actor = "agent" | "human";
export type Severity = "error" | "warning" | "info";
export type Category = "cpu" | "motherboard" | "ram" | "gpu" | "cooler" | "case" | "psu" | "storage";

export const CATEGORY_LABEL: Record<Category, string> = {
  cpu: "CPU",
  motherboard: "Motherboard",
  ram: "Memory",
  gpu: "Graphics",
  cooler: "Cooler",
  case: "Case",
  psu: "Power supply",
  storage: "Storage",
};

export const SLOT_ORDER: Category[] = ["cpu", "motherboard", "ram", "gpu", "cooler", "case", "psu", "storage"];

export interface SlotPart {
  id: string;
  name: string;
  brand: string;
  priceUSD: number;
  verified: boolean;
  /** One-line key spec, e.g. "AM5 · 8c/16t · 105 W". */
  spec: string;
  /** Attribute-derived fallback used when no reviewed part-specific thumbnail exists. */
  thumbnailFallback: import("../engine/cardArchetype").GenericCardArchetype;
}

export interface Conflict {
  code: string;
  severity: Severity;
  explanation: string;
  /** Categories the callout points at. */
  slots: Category[];
}

export interface FeedItem {
  id: string;
  actor: Actor;
  title: string;
  detail?: string;
  revision?: number;
  time: string;
  /** ISO timestamp, when known (used to merge the admin session log with the server log). */
  at?: string;
  undo?: "available" | "superseded" | "none";
}

export interface ClearanceReadout {
  used: number;
  max: number;
}
