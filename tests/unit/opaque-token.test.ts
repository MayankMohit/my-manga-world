import { describe, it, expect } from "vitest";
import {
  generateOpaqueToken,
  sha256Hex,
  timingSafeEqualHex,
} from "@/lib/auth/opaque-token";

describe("generateOpaqueToken", () => {
  it("is url-safe and unique across calls", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes base64url encodes to 43 chars.
    expect(a.length).toBe(43);
  });
});

describe("sha256Hex", () => {
  it("matches the known digest for the empty string", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("timingSafeEqualHex", () => {
  it("returns true for equal digests and false otherwise", () => {
    const h = sha256Hex("token");
    expect(timingSafeEqualHex(h, sha256Hex("token"))).toBe(true);
    expect(timingSafeEqualHex(h, sha256Hex("other"))).toBe(false);
  });

  it("returns false for mismatched lengths without throwing", () => {
    expect(timingSafeEqualHex("abcd", "ab")).toBe(false);
  });
});
