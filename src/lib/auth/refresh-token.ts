import { randomBytes, createHash } from "node:crypto";

/**
 * Opaque refresh tokens. The raw token is a 32-byte base64url string delivered
 * only in the httpOnly cookie; the database stores just its sha-256 hash, so a
 * database leak never yields usable tokens. Lookups are by hash (indexed).
 */

/** Generate a new random opaque refresh token (raw form, for the cookie). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash a refresh token for storage / lookup. Deterministic (sha-256, hex). */
export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
