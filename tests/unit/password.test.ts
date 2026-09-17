import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "wrong password entirely")).toBe(false);
  });

  it("produces a distinct hash each time (random salt)", async () => {
    const a = await hashPassword("same-password-value-1234");
    const b = await hashPassword("same-password-value-1234");
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, "same-password-value-1234")).toBe(true);
    expect(await verifyPassword(b, "same-password-value-1234")).toBe(true);
  });

  it("returns false (never throws) for a malformed hash", async () => {
    expect(await verifyPassword("not-a-real-argon2-hash", "whatever")).toBe(false);
  });
});
