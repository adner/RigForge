/**
 * Per-IP burst limiter (REVIEW_RESPONSES R2-#7): the Workers Rate-Limiting binding
 * (`RENDER_BURST`, 5 / 60 s) when available, else a permissive in-memory fixed window
 * for local dev (logged once). Never the accounting control — that is the RenderQuota DO.
 */
export interface BurstLimiter {
  /** true = allowed. */
  allow(key: string): Promise<boolean>;
}

export const clientKey = (request: Request): string => request.headers.get("cf-connecting-ip") ?? "local";

export const bindingLimiter = (rl: RateLimit): BurstLimiter => ({
  async allow(key) {
    const { success } = await rl.limit({ key });
    return success;
  },
});

export function memoryLimiter(limit = 5, periodSec = 60, now: () => number = Date.now): BurstLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    async allow(key) {
      const t = now();
      const w = windows.get(key);
      if (!w || t - w.start >= periodSec * 1000) {
        windows.set(key, { start: t, count: 1 });
        return true;
      }
      w.count += 1;
      return w.count <= limit;
    },
  };
}

let warned = false;
let fallback: BurstLimiter | null = null;

/** Picks the binding when present, else one shared in-memory limiter per isolate. */
export function burstLimiterFor(rl: RateLimit | undefined): BurstLimiter {
  if (rl) return bindingLimiter(rl);
  if (!warned) {
    warned = true;
    console.warn("RENDER_BURST binding unavailable; using in-memory burst limiter (local dev)");
  }
  return (fallback ??= memoryLimiter());
}
