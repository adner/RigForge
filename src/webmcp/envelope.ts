/**
 * Response envelope (DESIGN §4.4). Every tool response — success or failure — carries `buildRevision`
 * and the slim `digest`, and records the returned revision as `lastSeenRevision`.
 */
import { CATEGORIES, type Category } from "../data/schema";
import { buildTotalUSD, countConflicts, estimateWattage, isMultiSlot, partsIn, type ValidationDelta } from "../engine";
import { useStore, type StoreState } from "../store";
import { markSeen } from "./lastSeen";

export const ERROR_CODES = [
  "UNKNOWN_PART",
  "SLOT_OCCUPIED",
  "INVALID_INPUT",
  "STALE_REVISION",
  "DIRECTION_NOT_APPLICABLE",
  "BUDGET_INFEASIBLE",
  "RENDER_NEEDS_CASE",
  "VERIFICATION_REQUIRED",
  "RENDER_RATE_LIMITED",
  "RENDER_USER_DAILY_LIMIT",
  "RENDER_GLOBAL_DAILY_LIMIT",
  "RENDER_IN_PROGRESS",
  "RENDER_FAILED",
  "RENDER_UNAVAILABLE",
  "BACKEND_UNAVAILABLE",
  "CANCELLED",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface Digest {
  slots: Record<Category, string | string[] | null>;
  totalUSD: number;
  estWatts: number;
  validation: { errors: number; warnings: number; info: number };
}

export interface OkEnvelope<T = unknown> {
  ok: true;
  buildRevision: number;
  summary: string;
  digest: Digest;
  data: T;
  delta?: ValidationDelta;
}

export interface FailEnvelope {
  ok: false;
  buildRevision: number;
  summary: string;
  digest: Digest;
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}

export type Envelope<T = unknown> = OkEnvelope<T> | FailEnvelope;

export function digestOf(s: StoreState = useStore.getState()): Digest {
  const slots = {} as Digest["slots"];
  for (const c of CATEGORIES) {
    const ids = partsIn(s.build, c).map((p) => p.id);
    slots[c] = ids.length === 0 ? null : isMultiSlot(c) ? ids : ids[0]!;
  }
  return {
    slots,
    totalUSD: buildTotalUSD(s.build),
    estWatts: estimateWattage(s.build),
    validation: countConflicts(s.conflicts),
  };
}

/** Success envelope, JSON-stringified compact. Records the returned revision as last seen. */
export function ok<T>(data: T, opts: { summary: string; delta?: ValidationDelta }): string {
  const s = useStore.getState();
  const env: OkEnvelope<T> = { ok: true, buildRevision: s.buildRevision, summary: opts.summary, digest: digestOf(s), data };
  if (opts.delta) env.delta = opts.delta;
  markSeen(s.buildRevision);
  return JSON.stringify(env);
}

/** Failure envelope, JSON-stringified compact. Also records the returned revision as last seen. */
export function fail(code: ErrorCode, message: string, details?: Record<string, unknown>): string {
  const s = useStore.getState();
  const env: FailEnvelope = {
    ok: false,
    buildRevision: s.buildRevision,
    summary: message,
    digest: digestOf(s),
    error: details ? { code, message, details } : { code, message },
  };
  markSeen(s.buildRevision);
  return JSON.stringify(env);
}

/** Parses a tool response string back into an envelope (tests, UI feed). */
export const parseEnvelope = <T = unknown>(text: string): Envelope<T> => JSON.parse(text) as Envelope<T>;
