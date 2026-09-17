import { hash, verify } from "@node-rs/argon2";
import { PASSWORD_MIN_LENGTH } from "@/lib/shared/constants";

/**
 * Password hashing with argon2id (via @node-rs/argon2 — prebuilt N-API binaries,
 * so no native toolchain is needed on Windows dev or the ARM64 deploy target).
 * Parameters follow OWASP guidance and are tuned for roughly 150-250 ms per hash.
 * @node-rs/argon2 defaults to the Argon2id variant.
 */
const OPTIONS = {
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const;

/** Re-exported for convenience; the source of truth is shared constants. */
export const MIN_PASSWORD_LENGTH = PASSWORD_MIN_LENGTH;

/** Hash a plaintext password. The returned string is self-describing (encodes params + salt). */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

/**
 * Verify a plaintext password against a stored hash. Returns false (never throws)
 * for malformed hashes so callers can treat it as a generic auth failure.
 */
export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain, OPTIONS);
  } catch {
    return false;
  }
}
