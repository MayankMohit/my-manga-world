import { describe, it, expect } from "vitest";
import { generateRefreshToken, hashRefreshToken } from "@/lib/auth/refresh-token";

describe("refresh tokens", () => {
  it("generates unique, url-safe tokens", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it("hashes deterministically to 64 hex chars", () => {
    const raw = "some-refresh-token";
    expect(hashRefreshToken(raw)).toBe(hashRefreshToken(raw));
    expect(hashRefreshToken(raw)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different tokens", () => {
    expect(hashRefreshToken("a")).not.toBe(hashRefreshToken("b"));
  });
});
