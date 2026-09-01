/** Download validation for the offline vendor-reference card workflow. */

export const MAX_VENDOR_IMAGE_BYTES = 20 * 1024 * 1024;

const CONTENT_TYPES = {
  "image/jpeg": { extension: "jpg", signatures: [[0xff, 0xd8, 0xff]] },
  "image/png": { extension: "png", signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  "image/webp": { extension: "webp", signatures: [[0x52, 0x49, 0x46, 0x46]] },
} as const;

export interface VendorReference {
  bytes: Uint8Array;
  contentType: keyof typeof CONTENT_TYPES;
  extension: "jpg" | "png" | "webp";
  /** Host only: safe to record without retaining signed URL parameters. */
  sourceHost: string;
}

function fail(message: string): never {
  throw new Error(`vendor reference: ${message}`);
}

function parseHttpsUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(`${label} is not a valid URL`);
  }
  if (url.protocol !== "https:") fail(`${label} must use https`);
  if (url.username || url.password) fail(`${label} must not contain credentials`);
  return url;
}

function hasSignature(bytes: Uint8Array, type: keyof typeof CONTENT_TYPES): boolean {
  if (type === "image/webp") {
    return (
      bytes.length >= 12 &&
      CONTENT_TYPES[type].signatures[0].every((byte, index) => bytes[index] === byte) &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return CONTENT_TYPES[type].signatures.some((signature) => signature.every((byte, index) => bytes[index] === byte));
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) fail("download had no response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_VENDOR_IMAGE_BYTES) fail(`image exceeds ${MAX_VENDOR_IMAGE_BYTES / 1024 / 1024} MiB limit`);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Fetches one public vendor image into memory. The response is never persisted: callers
 * hand these bytes directly to the Images edits request and retain only generated output.
 */
export async function downloadVendorReference(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VendorReference> {
  let currentUrl = parseHttpsUrl(rawUrl, "URL");
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    response = await fetchImpl(currentUrl, {
      redirect: "manual",
      headers: { accept: "image/png,image/jpeg,image/webp" },
    });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location) fail(`redirect returned HTTP ${response.status} without a location`);
    if (redirects === 5) fail("download exceeded 5 redirects");
    currentUrl = parseHttpsUrl(new URL(location, currentUrl).href, "redirect target");
  }
  if (!response) fail("download did not return a response");
  if (!response.ok) fail(`download returned HTTP ${response.status}`);

  const rawType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!rawType || !(rawType in CONTENT_TYPES)) {
    fail(`unsupported content-type ${rawType ? JSON.stringify(rawType) : "(missing)"}; expected image/png, image/jpeg or image/webp`);
  }
  const contentType = rawType as keyof typeof CONTENT_TYPES;

  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_VENDOR_IMAGE_BYTES) {
    fail(`image exceeds ${MAX_VENDOR_IMAGE_BYTES / 1024 / 1024} MiB limit`);
  }
  const bytes = await readBoundedBody(response);
  if (!bytes.length) fail("download was empty");
  if (!hasSignature(bytes, contentType)) fail(`bytes do not match declared ${contentType}`);

  return { bytes, contentType, extension: CONTENT_TYPES[contentType].extension, sourceHost: currentUrl.host };
}
