import { describe, it, expect } from "vitest";
import {
  lockoutBackoffSeconds,
  LOCKOUT_THRESHOLD,
  LOCKOUT_WINDOW_SECONDS,
} from "@/lib/auth/lockout";

describe("lockoutBackoffSeconds", () => {
  it("does not lock below the threshold", () => {
    expect(lockoutBackoffSeconds(0)).toBe(0);
    expect(lockoutBackoffSeconds(LOCKOUT_THRESHOLD - 1)).toBe(0);
  });

  it("locks with exponential backoff at and above the threshold", () => {
    expect(lockoutBackoffSeconds(5)).toBe(30);
    expect(lockoutBackoffSeconds(6)).toBe(60);
    expect(lockoutBackoffSeconds(7)).toBe(120);
    expect(lockoutBackoffSeconds(8)).toBe(240);
  });

  it("caps the backoff at the window length", () => {
    expect(lockoutBackoffSeconds(50)).toBe(LOCKOUT_WINDOW_SECONDS);
  });
});
