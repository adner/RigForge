import { describe, expect, it, vi } from "vitest";
import { downloadVendorReference, MAX_VENDOR_IMAGE_BYTES } from "./vendor-reference";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function response(bytes: Uint8Array, init: { type?: string; url?: string; length?: number } = {}): Response {
  const res = new Response(bytes, {
    status: 200,
    headers: {
      "content-type": init.type ?? "image/png",
      ...(init.length === undefined ? {} : { "content-length": String(init.length) }),
    },
  });
  return res;
}

describe("downloadVendorReference", () => {
  it("accepts a bounded HTTPS image and returns only bytes plus safe metadata", async () => {
    const mockFetch = vi.fn(async () => response(png)) as unknown as typeof fetch;
    const result = await downloadVendorReference("https://vendor.example/product.png?secret=token", mockFetch);

    expect(mockFetch).toHaveBeenCalledWith(new URL("https://vendor.example/product.png?secret=token"), {
      redirect: "manual",
      headers: { accept: "image/png,image/jpeg,image/webp" },
    });
    expect(result).toEqual({ bytes: png, contentType: "image/png", extension: "png", sourceHost: "vendor.example" });
  });

  it.each(["http://vendor.example/card.png", "not-a-url"])("rejects non-public URL form %s", async (url) => {
    await expect(downloadVendorReference(url, vi.fn() as unknown as typeof fetch)).rejects.toThrow(/vendor reference/);
  });

  it("rejects unsupported or spoofed content", async () => {
    await expect(
      downloadVendorReference("https://vendor.example/card.svg", vi.fn(async () => response(png, { type: "image/svg+xml" })) as unknown as typeof fetch),
    ).rejects.toThrow(/unsupported content-type/);
    await expect(
      downloadVendorReference("https://vendor.example/card.png", vi.fn(async () => response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch),
    ).rejects.toThrow(/bytes do not match/);
  });

  it("rejects an oversized response before reading its body", async () => {
    const oversized = response(png, { length: MAX_VENDOR_IMAGE_BYTES + 1 });
    const body = oversized.body!;
    const getReader = vi.spyOn(body, "getReader");
    await expect(
      downloadVendorReference("https://vendor.example/card.png", vi.fn(async () => oversized) as unknown as typeof fetch),
    ).rejects.toThrow(/exceeds 20 MiB/);
    expect(getReader).not.toHaveBeenCalled();
  });

  it("stops a chunked response once it crosses the in-memory limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_VENDOR_IMAGE_BYTES));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const chunked = new Response(stream, { headers: { "content-type": "image/png" } });
    await expect(
      downloadVendorReference("https://vendor.example/card.png", vi.fn(async () => chunked) as unknown as typeof fetch),
    ).rejects.toThrow(/exceeds 20 MiB/);
  });

  it("rejects an HTTPS URL that redirects to a non-HTTPS target", async () => {
    const redirect = new Response(null, { status: 302, headers: { location: "http://cdn.vendor.example/card.png" } });
    await expect(
      downloadVendorReference(
        "https://vendor.example/card.png",
        vi.fn(async () => redirect) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/redirect target must use https/);
  });
});
