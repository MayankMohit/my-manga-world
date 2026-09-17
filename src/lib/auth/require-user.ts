import "server-only";
import { connectToDatabase } from "@/lib/db";
import { User } from "@/models/User";
import { Session } from "@/models/Session";
import { ApiError } from "@/lib/errors";
import type { UserRole } from "@/lib/shared/constants";
import { verifyAccessToken } from "@/lib/auth/access-token";
import { isJtiDenied } from "@/lib/auth/denylist";
import { readAccessCookie } from "@/lib/auth/cookies";

/**
 * Authoritative auth check for Node route handlers and server components. Runs
 * the full chain the optimistic proxy gate cannot: signature+exp, session exists
 * and not revoked, tokenVersion match, and jti not denylisted.
 */

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role: UserRole;
  tokenVersion: number;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  jti: string;
  /** access token expiry (seconds since epoch), for denylist TTL on logout */
  accessExp: number;
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const token = await readAccessCookie();
  if (!token) return null;

  const payload = await verifyAccessToken(token);
  if (!payload) return null;

  if (await isJtiDenied(payload.jti)) return null;

  await connectToDatabase();

  const session = await Session.findById(payload.sid).lean();
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const user = await User.findById(payload.sub).lean();
  if (!user) return null;
  if (user.tokenVersion !== payload.tv) return null;

  return {
    user: {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      tokenVersion: user.tokenVersion,
    },
    sessionId: payload.sid,
    jti: payload.jti,
    accessExp: payload.exp,
  };
}

/** Like `getAuthContext` but throws 401 when unauthenticated. */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw ApiError.unauthenticated();
  return ctx;
}
