import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { env } from "@/lib/env";
import { JWT_AUDIENCE } from "@/lib/auth/constants";

/**
 * JWT access tokens (HS256 via jose). This module is intentionally edge-safe: it
 * imports only jose + env and uses the global Web Crypto `crypto.randomUUID`, so
 * `proxy.ts` (edge runtime) can verify tokens without pulling in Node-only code.
 *
 * `verifyAccessToken` here is an OPTIMISTIC check (signature + exp + iss + aud).
 * Full revocation checks (session revoked, tokenVersion bump, jti denylist) live
 * in `requireUser()` which runs in the Node route-handler runtime.
 */

export interface AccessTokenPayload {
  /** user id */
  sub: string;
  /** session id */
  sid: string;
  /** token version (must match User.tokenVersion) */
  tv: number;
  /** unique token id, used for the denylist */
  jti: string;
  iat: number;
  exp: number;
}

const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface SignedAccessToken {
  token: string;
  jti: string;
  /** absolute expiry, seconds since epoch */
  exp: number;
}

export async function signAccessToken(input: {
  userId: string;
  sessionId: string;
  tokenVersion: number;
}): Promise<SignedAccessToken> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + env.JWT_ACCESS_TTL;
  const jti = crypto.randomUUID();

  const token = await new SignJWT({ sid: input.sessionId, tv: input.tokenVersion })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.userId)
    .setJti(jti)
    .setIssuedAt(now)
    .setIssuer(env.APP_URL)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(exp)
    .sign(secret);

  return { token, jti, exp };
}

/**
 * Verify signature, expiry, issuer, and audience. Returns the typed payload, or
 * null for any invalid/expired/tampered token (never throws).
 */
export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: env.APP_URL,
      audience: JWT_AUDIENCE,
      algorithms: ["HS256"],
    });
    const { sub, sid, tv, jti, iat, exp } = payload as Record<string, unknown>;
    if (
      typeof sub !== "string" ||
      typeof sid !== "string" ||
      typeof tv !== "number" ||
      typeof jti !== "string" ||
      typeof iat !== "number" ||
      typeof exp !== "number"
    ) {
      return null;
    }
    return { sub, sid, tv, jti, iat, exp };
  } catch (err) {
    // Expired / signature / claim failures are expected; anything else is too.
    if (err instanceof joseErrors.JOSEError) return null;
    return null;
  }
}
