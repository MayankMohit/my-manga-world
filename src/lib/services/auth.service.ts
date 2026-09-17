import "server-only";
import { connectToDatabase } from "@/lib/db";
import { User, type IUser } from "@/models/User";
import { EmailVerification } from "@/models/EmailVerification";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, revokeAllForUser } from "@/lib/auth/session";
import type { Types } from "mongoose";
import { signAccessToken } from "@/lib/auth/access-token";
import {
  generateVerificationCode,
  hashVerificationCode,
  verificationCodeMatches,
  classifyVerification,
  VERIFICATION_MAX_ATTEMPTS,
} from "@/lib/auth/verification";
import { sendVerificationCode, sendWelcome } from "@/lib/email/send";

/**
 * Signup/login/password-change business logic. Signup is open and self-serve but
 * email-verified: `startSignup` stashes an argon2-hashed password in a pending
 * `EmailVerification` doc and emails a code; `verifyEmailAndCreateAccount` turns
 * that into a real `User`. The only special case is admin bootstrap (first user,
 * or the configured BOOTSTRAP_ADMIN_EMAIL), which sets the role flag at account
 * creation but never gates signup.
 */

export interface IssuedTokens {
  accessToken: string;
  accessExp: number;
  refreshToken: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name?: string;
  role: IUser["role"];
}

interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

function toPublicUser(user: IUser): PublicUser {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

async function issueTokens(user: IUser, meta: SessionMeta): Promise<IssuedTokens> {
  const { session, rawRefreshToken } = await createSession(user._id, meta);
  const { token, exp } = await signAccessToken({
    userId: user._id.toString(),
    sessionId: session._id.toString(),
    tokenVersion: user.tokenVersion,
  });
  return { accessToken: token, accessExp: exp, refreshToken: rawRefreshToken };
}

/**
 * Step 1 of signup. Validates the email is free, argon2-hashes the password into
 * a pending `EmailVerification` (upsert: one per email), and emails a 6-digit
 * code. No `User` is created yet. A failure to send the email fails the request
 * so the user is never left waiting for a code that was never sent.
 */
export async function startSignup(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<{ email: string }> {
  await connectToDatabase();

  const email = input.email.toLowerCase().trim();
  const existing = await User.findOne({ email }).lean();
  if (existing) throw ApiError.conflict("An account with this email already exists");

  const passwordHash = await hashPassword(input.password);
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + env.EMAIL_VERIFICATION_TTL * 1000);

  await EmailVerification.findOneAndUpdate(
    { email },
    {
      $set: {
        codeHash: hashVerificationCode(code),
        passwordHash,
        name: input.name,
        attempts: 0,
        expiresAt,
      },
    },
    { upsert: true, new: true },
  );

  await sendVerificationCode({ to: email, code, name: input.name });
  return { email };
}

/**
 * Step 2 of signup. Confirms the code, creates the `User` from the pending doc,
 * sends a welcome email (best-effort), and logs the user in. Wrong codes are
 * counted and the pending signup is invalidated once the attempt cap is hit.
 */
export async function verifyEmailAndCreateAccount(
  input: { email: string; code: string },
  meta: SessionMeta = {},
): Promise<{ user: PublicUser; tokens: IssuedTokens }> {
  await connectToDatabase();

  const email = input.email.toLowerCase().trim();
  const pending = await EmailVerification.findOne({ email });
  if (!pending) {
    throw ApiError.badRequest(
      "This code is invalid or has expired. Please sign up again.",
    );
  }

  const verdict = classifyVerification(pending);
  if (verdict !== "valid") {
    await pending.deleteOne();
    throw ApiError.badRequest(
      verdict === "expired"
        ? "This code has expired. Please sign up again."
        : "Too many incorrect attempts. Please sign up again.",
    );
  }

  if (!verificationCodeMatches(pending.codeHash, input.code)) {
    pending.attempts += 1;
    if (pending.attempts >= VERIFICATION_MAX_ATTEMPTS) {
      await pending.deleteOne();
      throw ApiError.badRequest("Too many incorrect attempts. Please sign up again.");
    }
    await pending.save();
    throw ApiError.badRequest("Incorrect verification code.");
  }

  const bootstrapEmail = env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase();
  const isFirstUser = (await User.estimatedDocumentCount()) === 0;
  const role = isFirstUser || email === bootstrapEmail ? "admin" : "user";

  let user: IUser;
  try {
    user = await User.create({
      email,
      passwordHash: pending.passwordHash,
      name: pending.name,
      role,
    });
  } catch (err: unknown) {
    // Unique-index race: the account was created between check and insert.
    if (err && typeof err === "object" && "code" in err && err.code === 11000) {
      await pending.deleteOne();
      throw ApiError.conflict("An account with this email already exists");
    }
    throw err;
  }

  await pending.deleteOne();

  // Welcome email is best-effort: never block account creation on it.
  try {
    await sendWelcome({ to: email, name: user.name });
  } catch (err) {
    logger.warn({ err }, "Welcome email failed to send");
  }

  // Phase 3 (D26): claim any anonymous uploads for this browser session here.

  const tokens = await issueTokens(user, meta);
  return { user: toPublicUser(user), tokens };
}

/**
 * Regenerate and resend a verification code for a pending signup. Returns
 * silently when no pending signup exists (no account enumeration). Rate limited
 * by the route.
 */
export async function resendVerification(emailInput: string): Promise<void> {
  await connectToDatabase();

  const email = emailInput.toLowerCase().trim();
  const pending = await EmailVerification.findOne({ email });
  if (!pending) return;

  const code = generateVerificationCode();
  pending.codeHash = hashVerificationCode(code);
  pending.attempts = 0;
  pending.expiresAt = new Date(Date.now() + env.EMAIL_VERIFICATION_TTL * 1000);
  await pending.save();

  await sendVerificationCode({ to: email, code, name: pending.name });
}

/**
 * Verify credentials and issue tokens. Throws a generic 401 on any failure so
 * valid vs invalid emails are indistinguishable. Lockout is enforced by the
 * caller (route handler) around this call.
 */
export async function login(
  input: { email: string; password: string },
  meta: SessionMeta = {},
): Promise<{ user: PublicUser; tokens: IssuedTokens }> {
  await connectToDatabase();

  const email = input.email.toLowerCase().trim();
  const user = await User.findOne({ email });

  const ok = user ? await verifyPassword(user.passwordHash, input.password) : false;
  if (!user || !ok) {
    throw ApiError.unauthenticated("Invalid email or password");
  }

  // Phase 3 (D26): claim any anonymous uploads for this browser session here.

  const tokens = await issueTokens(user, meta);
  return { user: toPublicUser(user), tokens };
}

/**
 * Change password: verify current, set new hash, bump tokenVersion (kills all
 * outstanding access tokens), revoke every other session, and reissue a fresh
 * access token for the current session.
 */
/**
 * Sign a fresh access token for an existing session (used by the refresh route
 * after rotation), reading the current tokenVersion from the user record.
 */
export async function issueAccessForSession(
  userId: string | Types.ObjectId,
  sessionId: string,
): Promise<{ accessToken: string; accessExp: number }> {
  await connectToDatabase();
  const user = await User.findById(userId).lean();
  if (!user) throw ApiError.unauthenticated();
  const { token, exp } = await signAccessToken({
    userId: user._id.toString(),
    sessionId,
    tokenVersion: user.tokenVersion,
  });
  return { accessToken: token, accessExp: exp };
}

/** Revoke every session for the user and bump tokenVersion (logout-all). */
export async function logoutEverywhere(userId: string | Types.ObjectId): Promise<void> {
  await connectToDatabase();
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  await revokeAllForUser(userId);
}

export async function changePassword(input: {
  userId: string;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<{ accessToken: string; accessExp: number }> {
  await connectToDatabase();

  const user = await User.findById(input.userId);
  if (!user) throw ApiError.unauthenticated();

  const ok = await verifyPassword(user.passwordHash, input.currentPassword);
  if (!ok) throw ApiError.badRequest("Current password is incorrect");

  user.passwordHash = await hashPassword(input.newPassword);
  user.tokenVersion += 1;
  await user.save();

  await revokeAllForUser(user._id, input.currentSessionId);

  const { token, exp } = await signAccessToken({
    userId: user._id.toString(),
    sessionId: input.currentSessionId,
    tokenVersion: user.tokenVersion,
  });
  return { accessToken: token, accessExp: exp };
}
