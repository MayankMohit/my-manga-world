import { describe, it, expect } from "vitest";
import { classifyRefreshSession } from "@/lib/auth/session";

const now = new Date("2026-01-01T00:00:00Z");
const future = new Date(now.getTime() + 60_000);
const past = new Date(now.getTime() - 60_000);

describe("classifyRefreshSession", () => {
  it("treats an active, unexpired session as valid", () => {
    expect(classifyRefreshSession({ expiresAt: future }, now)).toBe("valid");
  });

  it("treats an expired session as expired", () => {
    expect(classifyRefreshSession({ expiresAt: past }, now)).toBe("expired");
  });

  it("treats a revoked token presented again as reuse", () => {
    expect(classifyRefreshSession({ revokedAt: past, expiresAt: future }, now)).toBe(
      "reuse",
    );
  });

  it("prioritizes reuse detection over expiry", () => {
    expect(classifyRefreshSession({ revokedAt: past, expiresAt: past }, now)).toBe(
      "reuse",
    );
  });
});
