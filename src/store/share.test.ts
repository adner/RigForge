import { describe, expect, it } from "vitest";
import * as F from "../engine/__fixtures__/parts";
import { buildFromParts } from "../engine";
import { decodeShare, encodeShare, fragmentForPayload, payloadFromBuild, resolveSharedParts, shareFromFragment, SHARE_MAX_BYTES } from "./share";

describe("share payload", () => {
  it("round-trips a build + goal through #b=", () => {
    const payload = payloadFromBuild(buildFromParts(F.GOOD_PARTS), { useCase: "gaming", budgetUSD: 2500, preferences: { noise: "quiet" } });
    const frag = fragmentForPayload(payload);
    expect(frag.startsWith("#b=")).toBe(true);
    expect(/[+=]|\//.test(frag.slice(3))).toBe(false);
    const decoded = decodeShare(shareFromFragment(frag)!);
    expect(decoded).toEqual({ ok: true, payload });
  });

  it("rejects malformed, wrong version and oversized payloads with friendly codes", () => {
    expect(decodeShare("")).toMatchObject({ ok: false, code: "EMPTY" });
    expect(decodeShare("!!!not-base64!!!")).toMatchObject({ ok: false, code: "MALFORMED" });
    expect(decodeShare(btoa('{"v":2,"parts":[]}'))).toMatchObject({ ok: false, code: "UNSUPPORTED_VERSION" });
    expect(decodeShare(btoa('{"v":1,"parts":[],"extra":1}'))).toMatchObject({ ok: false, code: "MALFORMED" });
    expect(decodeShare(btoa('{"v":1,"parts":"x"}'))).toMatchObject({ ok: false, code: "MALFORMED" });
    const big = btoa(JSON.stringify({ v: 1, parts: Array.from({ length: 32 }, () => "x".repeat(80)) }));
    expect(decodeShare(big)).toMatchObject({ ok: false, code: "TOO_LARGE" });
    expect(() => encodeShare({ v: 1, parts: Array.from({ length: 40 }, () => "y".repeat(70)) })).toThrow(/limit/);
  });

  it("drops unknown ids with a notice", () => {
    const r = resolveSharedParts({ v: 1, parts: [F.cpu9800x3d.id, "cpu-ghost"] }, F.CATALOG);
    expect(r.partIds).toEqual([F.cpu9800x3d.id]);
    expect(r.unknownIds).toEqual(["cpu-ghost"]);
    expect(r.notice).toMatch(/cpu-ghost/);
  });

  it("a full 8-slot build with the longest fixture ids stays far under 2 KB", () => {
    const payload = payloadFromBuild(buildFromParts(F.GOOD_PARTS), { useCase: "video-editing", budgetUSD: 9999, preferences: { noise: "quiet", size: "compact", lighting: "rgb", color: "white" } });
    expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBeLessThan(SHARE_MAX_BYTES / 4);
  });
});
