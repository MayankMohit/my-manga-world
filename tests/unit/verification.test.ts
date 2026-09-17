import { describe, it, expect } from "vitest";
import {
  generateVerificationCode,
  hashVerificationCode,
  verificationCodeMatches,
  classifyVerification,
  VERIFICATION_MAX_ATTEMPTS,
} from "@/lib/auth/verification";
import { VERIFICATION_CODE_LENGTH } from "@/lib/shared/constants";

describe("generateVerificationCode", () => {
  it("produces a zero-padded numeric code of the configured length", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateVerificationCode();
      expect(code).toMatch(new RegExp(`^\\d{${VERIFICATION_CODE_LENGTH}}$`));
      expect(code.length).toBe(VERIFICATION_CODE_LENGTH);
    }
  });
});

describe("verification code hashing", () => {
  it("hashes deterministically and ignores surrounding whitespace", () => {
    expect(hashVerificationCode("123456")).toBe(hashVerificationCode(" 123456 "));
  });

  it("matches the correct code and rejects a wrong one", () => {
    const hash = hashVerificationCode("013247");
    expect(verificationCodeMatches(hash, "013247")).toBe(true);
    expect(verificationCodeMatches(hash, "999999")).toBe(false);
    expect(verificationCodeMatches(hash, "13247")).toBe(false);
  });
});

describe("classifyVerification", () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it("is valid when unexpired and under the attempt cap", () => {
    expect(classifyVerification({ attempts: 0, expiresAt: future })).toBe("valid");
  });

  it("reports expiry", () => {
    expect(classifyVerification({ attempts: 0, expiresAt: past })).toBe("expired");
  });

  it("reports the attempt cap before expiry", () => {
    expect(
      classifyVerification({ attempts: VERIFICATION_MAX_ATTEMPTS, expiresAt: past }),
    ).toBe("too-many-attempts");
  });
});
