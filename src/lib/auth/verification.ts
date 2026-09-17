import { randomInt } from "node:crypto";
import { sha256Hex, timingSafeEqualHex } from "@/lib/auth/opaque-token";
import { VERIFICATION_CODE_LENGTH } from "@/lib/shared/constants";

/**
 * Email-verification code helpers. Codes are short (6 digits) so their security
 * rests on: a short TTL, an attempt cap, and auth-strict rate limiting, not on
 * the hash. We still store only the hash at rest and compare in constant time.
 * The classification is a pure function so it can be unit-tested without a DB.
 */

export const VERIFICATION_MAX_ATTEMPTS = 5;

/** A zero-padded numeric code, generated without modulo bias. */
export function generateVerificationCode(): string {
  const max = 10 ** VERIFICATION_CODE_LENGTH; // exclusive upper bound
  return String(randomInt(0, max)).padStart(VERIFICATION_CODE_LENGTH, "0");
}

/** sha-256 of a code (what we persist). */
export function hashVerificationCode(code: string): string {
  return sha256Hex(code.trim());
}

/** Constant-time check of a submitted code against the stored hash. */
export function verificationCodeMatches(storedHash: string, submitted: string): boolean {
  return timingSafeEqualHex(storedHash, hashVerificationCode(submitted));
}

export type VerificationVerdict = "valid" | "expired" | "too-many-attempts";

/**
 * Decide whether a pending verification can still accept a code. Attempts are
 * checked before expiry so an exhausted record is reported as such regardless of
 * clock, and the caller invalidates it either way.
 */
export function classifyVerification(
  record: { attempts: number; expiresAt: Date },
  now: Date = new Date(),
): VerificationVerdict {
  if (record.attempts >= VERIFICATION_MAX_ATTEMPTS) return "too-many-attempts";
  if (record.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}
