import { describe, expect, it } from "vitest";
import { approximateDataUrlBytes, assertReferencePayloadWithinLimit } from "./useAppStore";

// A base64 string of length n decodes to ~3n/4 bytes.
function fakeDataUrl(base64Length: number): string {
  return "data:image/png;base64," + "A".repeat(base64Length);
}

describe("approximateDataUrlBytes", () => {
  it("estimates decoded size from the base64 payload length, ignoring the data: prefix", () => {
    const url = fakeDataUrl(4000); // -> ~3000 bytes
    expect(approximateDataUrlBytes(url)).toBe(3000);
  });

  it("handles a URL with no comma (no header) by treating the whole string as payload", () => {
    expect(approximateDataUrlBytes("AAAA")).toBe(3);
  });
});

describe("assertReferencePayloadWithinLimit", () => {
  it("does not throw for a small handful of real-sized reference images", () => {
    const twoMegabytesOfBase64 = Math.floor((2 * 1024 * 1024 * 4) / 3);
    const urls = [fakeDataUrl(twoMegabytesOfBase64), fakeDataUrl(twoMegabytesOfBase64)];
    expect(() => assertReferencePayloadWithinLimit(urls)).not.toThrow();
  });

  it("throws a clear, actionable error once the total exceeds the cap", () => {
    // 60MB cap (MAX_REFERENCE_PAYLOAD_BYTES) — build well past it.
    const seventyMegabytesOfBase64 = Math.floor((70 * 1024 * 1024 * 4) / 3);
    const urls = [fakeDataUrl(seventyMegabytesOfBase64)];
    expect(() => assertReferencePayloadWithinLimit(urls)).toThrow(/over the 60MB limit/);
  });

  it("sums across every url in the array, not just the largest one", () => {
    // Five images at ~15MB each = ~75MB total, over the 60MB cap, even though no single
    // image is anywhere near it — this is exactly the gap this session's security review flagged.
    const fifteenMegabytesOfBase64 = Math.floor((15 * 1024 * 1024 * 4) / 3);
    const urls = Array.from({ length: 5 }, () => fakeDataUrl(fifteenMegabytesOfBase64));
    expect(() => assertReferencePayloadWithinLimit(urls)).toThrow();
  });
});
