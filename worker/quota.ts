/**
 * Atomic render spend guard. One global Durable Object owns both the global counter and
 * anonymous-device counters, so a cold render either consumes both allowances or neither.
 * A short hash lease prevents concurrent cache misses from multiplying provider calls.
 */
export type QuotaDenialReason = "user" | "global" | "in_flight";

export interface QuotaResult {
  allowed: boolean;
  reason?: QuotaDenialReason;
  userLimit: number;
  userRemaining: number;
  globalLimit: number;
  globalRemaining: number;
  retryAfterSec: number;
  resetsAt: string;
  day: string;
}

export interface QuotaClient {
  consume(uid: string, renderId: string): Promise<QuotaResult>;
  release(renderId: string): Promise<void>;
  status(uid: string): Promise<QuotaResult>;
}

interface StorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
}

interface DailyState {
  day: string;
  globalUsed: number;
  users: Record<string, number>;
  leases: Record<string, number>;
}

export const DEFAULT_GLOBAL_DAILY_CAP = 200;
export const DEFAULT_USER_DAILY_CAP = 10;
export const DEFAULT_LEASE_SEC = 90;
const STATE_KEY = "quota-v2";

export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

const nextUtcDay = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
const secondsToNextUtcDay = (now: Date): number => Math.max(1, Math.ceil((nextUtcDay(now).getTime() - now.getTime()) / 1000));
const blankState = (now: Date): DailyState => ({ day: utcDay(now), globalUsed: 0, users: {}, leases: {} });

const loadState = async (storage: StorageLike, now: Date): Promise<DailyState> => {
  const stored = await storage.get<DailyState>(STATE_KEY);
  if (!stored || stored.day !== utcDay(now)) return blankState(now);
  const nowMs = now.getTime();
  const leases = Object.fromEntries(Object.entries(stored.leases ?? {}).filter(([, until]) => Number.isFinite(until) && until > nowMs));
  return { day: stored.day, globalUsed: stored.globalUsed ?? 0, users: stored.users ?? {}, leases };
};

const resultFor = (state: DailyState, uid: string, globalCap: number, userCap: number, now: Date, extra: Partial<QuotaResult> = {}): QuotaResult => ({
  allowed: true,
  userLimit: userCap,
  userRemaining: Math.max(0, userCap - (state.users[uid] ?? 0)),
  globalLimit: globalCap,
  globalRemaining: Math.max(0, globalCap - state.globalUsed),
  retryAfterSec: 0,
  resetsAt: nextUtcDay(now).toISOString(),
  day: state.day,
  ...extra,
});

/** Pure storage step used by the DO and unit tests. */
export async function consumeDaily(
  storage: StorageLike,
  globalCap: number,
  userCap: number,
  uid: string,
  renderId: string,
  now: Date,
  leaseSec = DEFAULT_LEASE_SEC,
): Promise<QuotaResult> {
  const state = await loadState(storage, now);
  const leaseUntil = state.leases[renderId];
  if (leaseUntil && leaseUntil > now.getTime()) {
    return resultFor(state, uid, globalCap, userCap, now, {
      allowed: false,
      reason: "in_flight",
      retryAfterSec: Math.max(1, Math.ceil((leaseUntil - now.getTime()) / 1000)),
    });
  }
  if (state.globalUsed >= globalCap) {
    return resultFor(state, uid, globalCap, userCap, now, { allowed: false, reason: "global", retryAfterSec: secondsToNextUtcDay(now) });
  }
  if ((state.users[uid] ?? 0) >= userCap) {
    return resultFor(state, uid, globalCap, userCap, now, { allowed: false, reason: "user", retryAfterSec: secondsToNextUtcDay(now) });
  }
  state.globalUsed += 1;
  state.users[uid] = (state.users[uid] ?? 0) + 1;
  state.leases[renderId] = now.getTime() + leaseSec * 1000;
  await storage.put(STATE_KEY, state);
  return resultFor(state, uid, globalCap, userCap, now);
}

export async function quotaStatus(storage: StorageLike, globalCap: number, userCap: number, uid: string, now: Date): Promise<QuotaResult> {
  return resultFor(await loadState(storage, now), uid, globalCap, userCap, now);
}

export async function releaseLease(storage: StorageLike, renderId: string, now: Date): Promise<void> {
  const state = await loadState(storage, now);
  if (!(renderId in state.leases)) return;
  delete state.leases[renderId];
  await storage.put(STATE_KEY, state);
}

export const parseCap = (raw: string | undefined, fallback = DEFAULT_GLOBAL_DAILY_CAP): number => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

export class RenderQuota {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: { RENDER_DAILY_CAP?: string; RENDER_USER_DAILY_CAP?: string },
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const globalCap = parseCap(this.env.RENDER_DAILY_CAP, DEFAULT_GLOBAL_DAILY_CAP);
    const userCap = parseCap(this.env.RENDER_USER_DAILY_CAP, DEFAULT_USER_DAILY_CAP);
    const now = new Date();
    const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as { uid?: unknown; renderId?: unknown }) : {};
    if (typeof body.uid !== "string") return Response.json({ error: "uid required" }, { status: 400 });
    if (url.pathname === "/consume" && request.method === "POST" && typeof body.renderId === "string") {
      return Response.json(await consumeDaily(this.state.storage, globalCap, userCap, body.uid, body.renderId, now));
    }
    if (url.pathname === "/release" && request.method === "POST" && typeof body.renderId === "string") {
      await releaseLease(this.state.storage, body.renderId, now);
      return Response.json({ released: true });
    }
    if (url.pathname === "/status" && request.method === "POST") {
      return Response.json(await quotaStatus(this.state.storage, globalCap, userCap, body.uid, now));
    }
    return new Response("not found", { status: 404 });
  }
}

export const quotaClient = (ns: DurableObjectNamespace): QuotaClient => {
  const stub = () => ns.get(ns.idFromName("global"));
  const post = async <T>(path: string, body: Record<string, string>): Promise<T> => {
    const res = await stub().fetch(`https://quota${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`quota service failed (${res.status})`);
    return (await res.json()) as T;
  };
  return {
    consume: (uid, renderId) => post<QuotaResult>("/consume", { uid, renderId }),
    release: async (renderId) => void (await post<{ released: boolean }>("/release", { uid: "internal", renderId })),
    status: (uid) => post<QuotaResult>("/status", { uid }),
  };
};

export const memoryQuota = (
  globalCap: number,
  userCap = DEFAULT_USER_DAILY_CAP,
  now: () => Date = () => new Date(),
): QuotaClient & { store: Map<string, unknown> } => {
  const store = new Map<string, unknown>();
  const storage: StorageLike = {
    async get<T>(k: string) {
      return store.get(k) as T | undefined;
    },
    async put(k, v) {
      store.set(k, v);
    },
  };
  return {
    store,
    consume: (uid, renderId) => consumeDaily(storage, globalCap, userCap, uid, renderId, now()),
    release: (renderId) => releaseLease(storage, renderId, now()),
    status: (uid) => quotaStatus(storage, globalCap, userCap, uid, now()),
  };
};
