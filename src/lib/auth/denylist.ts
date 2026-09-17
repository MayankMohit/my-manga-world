import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { DENYLIST_PREFIX } from "@/lib/auth/constants";

/**
 * Access-token (jti) denylist for immediate logout. Best-effort: the durable
 * revocation guarantees are session `revokedAt` and `User.tokenVersion` (both in
 * Mongo). If Redis is unavailable the denylist read misses (fail-open) and the
 * Mongo-backed checks still apply, so a token cannot outlive its 15-minute exp.
 */

function key(jti: string): string {
  return `${DENYLIST_PREFIX}:${jti}`;
}

/** Deny a token id until its natural expiry. `ttlSeconds` should be exp - now. */
export async function denyJti(jti: string, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) return;
  try {
    await redis.set(key(jti), "1", "EX", ttlSeconds);
  } catch (err) {
    logger.error({ err }, "Failed to add jti to denylist");
  }
}

/** True if the token id has been explicitly revoked. Fails open on Redis error. */
export async function isJtiDenied(jti: string): Promise<boolean> {
  try {
    return (await redis.exists(key(jti))) === 1;
  } catch (err) {
    logger.error({ err }, "Denylist check failed; treating as not denied");
    return false;
  }
}
