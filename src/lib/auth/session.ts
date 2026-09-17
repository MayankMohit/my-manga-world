import mongoose, { type Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { Session, type ISession } from "@/models/Session";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { generateRefreshToken, hashRefreshToken } from "@/lib/auth/refresh-token";

/**
 * Refresh-session lifecycle: creation, rotation with reuse detection, and
 * revocation. The rotation *decision* is factored into the pure
 * `classifyRefreshSession` so it can be unit-tested without a database.
 */

export type RefreshClassification = "valid" | "expired" | "reuse";

/**
 * Decide what a presented refresh session means. A session that is already
 * revoked but presented again indicates token reuse (assume compromise); an
 * expired session is simply invalid; otherwise it is valid and may rotate.
 */
export function classifyRefreshSession(
  session: { revokedAt?: Date | null; expiresAt: Date },
  now: Date = new Date(),
): RefreshClassification {
  if (session.revokedAt) return "reuse";
  if (session.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

async function insertSession(
  userId: Types.ObjectId,
  familyId: string,
  meta: SessionMeta,
): Promise<{ session: ISession; rawRefreshToken: string }> {
  const raw = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL * 1000);
  const session = await Session.create({
    userId,
    refreshTokenHash: hashRefreshToken(raw),
    familyId,
    userAgent: meta.userAgent,
    ip: meta.ip,
    expiresAt,
  });
  return { session, rawRefreshToken: raw };
}

/** Start a brand-new session family (used at login/signup). */
export async function createSession(
  userId: Types.ObjectId,
  meta: SessionMeta = {},
): Promise<{ session: ISession; rawRefreshToken: string }> {
  await connectToDatabase();
  return insertSession(userId, crypto.randomUUID(), meta);
}

/**
 * Rotate a refresh token. On reuse of an already-revoked token the whole family
 * is revoked and the caller is forced to re-authenticate.
 */
export async function rotateSession(
  rawRefreshToken: string,
  meta: SessionMeta = {},
): Promise<{ session: ISession; rawRefreshToken: string; userId: string }> {
  await connectToDatabase();
  const session = await Session.findOne({
    refreshTokenHash: hashRefreshToken(rawRefreshToken),
  });
  if (!session) throw ApiError.unauthenticated("Invalid session");

  const verdict = classifyRefreshSession(session);
  if (verdict === "reuse") {
    await revokeFamily(session.familyId);
    throw ApiError.unauthenticated("Session reuse detected");
  }
  if (verdict === "expired") {
    throw ApiError.unauthenticated("Session expired");
  }

  const next = await insertSession(session.userId, session.familyId, meta);
  session.revokedAt = new Date();
  session.replacedBy = next.session._id;
  await session.save();

  return {
    session: next.session,
    rawRefreshToken: next.rawRefreshToken,
    userId: session.userId.toString(),
  };
}

/** Revoke a single session by id (idempotent). */
export async function revokeSession(sessionId: Types.ObjectId | string): Promise<void> {
  await connectToDatabase();
  await Session.updateOne(
    { _id: sessionId, revokedAt: mongoose.trusted({ $exists: false }) },
    { $set: { revokedAt: new Date() } },
  );
}

/** Revoke every session in a family (reuse response). */
export async function revokeFamily(familyId: string): Promise<void> {
  await connectToDatabase();
  await Session.updateMany(
    { familyId, revokedAt: mongoose.trusted({ $exists: false }) },
    { $set: { revokedAt: new Date() } },
  );
}

/** Revoke every active session for a user (logout-all / password change). */
export async function revokeAllForUser(
  userId: Types.ObjectId | string,
  exceptSessionId?: Types.ObjectId | string,
): Promise<void> {
  await connectToDatabase();
  const filter: Record<string, unknown> = {
    userId,
    revokedAt: mongoose.trusted({ $exists: false }),
  };
  if (exceptSessionId) filter._id = mongoose.trusted({ $ne: exceptSessionId });
  await Session.updateMany(filter, { $set: { revokedAt: new Date() } });
}

/**
 * Revoke a specific session that must belong to `userId`. Returns false if no
 * such active session exists (so the route can answer 404 without leaking).
 */
export async function revokeUserSession(
  userId: Types.ObjectId | string,
  sessionId: string,
): Promise<boolean> {
  await connectToDatabase();
  const res = await Session.updateOne(
    { _id: sessionId, userId, revokedAt: mongoose.trusted({ $exists: false }) },
    { $set: { revokedAt: new Date() } },
  );
  return res.matchedCount > 0;
}

/** List a user's active sessions, newest first. */
export async function listActiveSessions(
  userId: Types.ObjectId | string,
): Promise<ISession[]> {
  await connectToDatabase();
  return Session.find({
    userId,
    revokedAt: mongoose.trusted({ $exists: false }),
    expiresAt: mongoose.trusted({ $gt: new Date() }),
  })
    .sort({ createdAt: -1 })
    .lean<ISession[]>();
}
