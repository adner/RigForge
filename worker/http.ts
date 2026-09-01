/** Small HTTP helpers shared by all Worker routes: JSON envelope, errors, body cap. */

export const MAX_BODY_BYTES = 16 * 1024;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const json = (body: unknown, init: ResponseInit = {}): Response => {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
};

export const ok = (body: Record<string, unknown>, init: ResponseInit = {}): Response => json({ ok: true, ...body }, init);

export const errorResponse = (status: number, code: string, message: string, details?: unknown): Response =>
  json({ ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } }, { status });

export const toResponse = (err: unknown): Response => {
  if (err instanceof ApiError) return errorResponse(err.status, err.code, err.message, err.details);
  return errorResponse(500, "INTERNAL", "Unexpected error");
};

/** Reads a JSON body of at most `max` bytes. 413 if larger, 400 if not JSON. */
export async function readJsonBody(request: Request, max = MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) throw new ApiError(413, "BODY_TOO_LARGE", `Body exceeds ${max} bytes`);
  if (!request.body) throw new ApiError(400, "BAD_JSON", "Missing JSON body");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new ApiError(413, "BODY_TOO_LARGE", `Body exceeds ${max} bytes`);
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new ApiError(400, "BAD_JSON", "Body is not valid JSON");
  }
}
