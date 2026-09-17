import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { ApiError } from "@/lib/errors";
import { CACHE_PREFIX } from "@/lib/shared/constants";

/**
 * Login lockout: after repeated failed logins within a window, further attempts
 * for the same IP or email are blocked with an exponential backoff (429). This is
 * separate from the coarse per-route rate limiter and is keyed on credentials.
 */

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_WINDOW_SECONDS = 900; // 15 minutes

/**
 * Backoff (seconds) to lock for, given the failure count in the window. Pure and
 * deterministic so it can be unit-tested. 0 means "not yet locked".
 *   <5 -> 0, 5 -> 30, 6 -> 60, 7 -> 120, ... capped at the window length.
 */
export function lockoutBackoffSeconds(failCount: number): number {
  if (failCount < LOCKOUT_THRESHOLD) return 0;
  const over = failCount - LOCKOUT_THRESHOLD;
  const seconds = 30 * 2 ** over;
  return Math.min(seconds, LOCKOUT_WINDOW_SECONDS);
}

function countKey(scope: "ip" | "email", id: string): string {
  return `${CACHE_PREFIX}:lockout:cnt:${scope}:${id}`;
}
function lockKey(scope: "ip" | "email", id: string): string {
  return `${CACHE_PREFIX}:lockout:lock:${scope}:${id}`;
}

/**
 * Throw 429 if either the IP or the email is currently locked. Call before
 * verifying credentials. Fails OPEN on Redis error (login stays available; the
 * per-route auth-strict limiter, which fails closed, still applies).
 */
export async function assertNotLockedOut(ip: string, email: string): Promise<void> {
  try {
    const [ipTtl, emailTtl] = await Promise.all([
      redis.ttl(lockKey("ip", ip)),
      redis.ttl(lockKey("email", email)),
    ]);
    const retryAfter = Math.max(ipTtl, emailTtl);
    if (retryAfter > 0) {
      throw ApiError.rateLimited(
        "Too many failed attempts. Try again later.",
        retryAfter,
      );
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    logger.error({ err }, "Lockout check failed; allowing attempt");
  }
}

/** Record a failed login for both scopes and (re)arm the lock once over threshold. */
export async function recordFailedLogin(ip: string, email: string): Promise<void> {
  for (const [scope, id] of [
    ["ip", ip],
    ["email", email],
  ] as const) {
    try {
      const count = await redis.incr(countKey(scope, id));
      if (count === 1) await redis.expire(countKey(scope, id), LOCKOUT_WINDOW_SECONDS);
      const backoff = lockoutBackoffSeconds(count);
      if (backoff > 0) await redis.set(lockKey(scope, id), "1", "EX", backoff);
    } catch (err) {
      logger.error({ err, scope }, "Failed to record login failure");
    }
  }
}

/** Clear counters + locks after a successful login. */
export async function clearLockout(ip: string, email: string): Promise<void> {
  const keys = [
    countKey("ip", ip),
    countKey("email", email),
    lockKey("ip", ip),
    lockKey("email", email),
  ];
  try {
    await redis.del(...keys);
  } catch (err) {
    logger.error({ err }, "Failed to clear lockout");
  }
}
