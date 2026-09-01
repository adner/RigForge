/**
 * Admin tool envelope (DESIGN §4.7). Simpler than the shopper one: no build digest.
 *   { ok: true,  summary, data }
 *   { ok: false, error: { code, message, details? } }
 */
export type AdminErrorCode =
  | "INVALID_INPUT"
  | "CONFIRM_REQUIRED"
  | "VERIFIED_IS_HUMAN_ONLY"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "ACCESS_NOT_CONFIGURED"
  | "BACKEND_UNAVAILABLE"
  | "CATEGORY_MISMATCH"
  | "INTERNAL"
  | (string & {});

export interface AdminOk<T = unknown> {
  ok: true;
  summary: string;
  data: T;
}
export interface AdminFail {
  ok: false;
  error: { code: AdminErrorCode; message: string; details?: unknown };
}
export type AdminEnvelope<T = unknown> = AdminOk<T> | AdminFail;

export const ok = <T>(summary: string, data: T): AdminOk<T> => ({ ok: true, summary, data });

export const fail = (code: AdminErrorCode, message: string, details?: unknown): AdminFail => ({
  ok: false,
  error: { code, message, ...(details !== undefined ? { details } : {}) },
});

/** Thrown by the API client; carries the Worker's error code + HTTP status. */
export class AdminApiError extends Error {
  constructor(
    public readonly code: AdminErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
  toEnvelope(): AdminFail {
    return fail(this.code, this.message, this.details);
  }
}

/** Maps any thrown value to an error envelope (tools must never throw to the agent). */
export const toEnvelope = (err: unknown): AdminFail => {
  if (err instanceof AdminApiError) return err.toEnvelope();
  if (err instanceof Error) return fail("INTERNAL", err.message);
  return fail("INTERNAL", "Unexpected error");
};
