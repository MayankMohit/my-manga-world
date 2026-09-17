import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * Opaque-token primitives shared by password reset and email verification.
 * Tokens are random and delivered out of band (email); only their sha-256 hash
 * is ever persisted. Kept in its own module (node:crypto) so nothing edge-only
 * pulls it in.
 */

/** A URL-safe random token. 32 bytes → 43 base64url chars (~256 bits). */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Lowercase-hex sha-256 of a string. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Constant-time comparison of two hex digests (equal length assumed). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
