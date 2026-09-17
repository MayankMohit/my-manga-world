import "server-only";
import { connectToDatabase } from "@/lib/db";
import { User } from "@/models/User";
import { PasswordReset } from "@/models/PasswordReset";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { hashPassword } from "@/lib/auth/password";
import { generateOpaqueToken, sha256Hex } from "@/lib/auth/opaque-token";
import { revokeAllForUser } from "@/lib/auth/session";
import { sendPasswordReset, sendPasswordChanged } from "@/lib/email/send";

/**
 * Password reset by email (D27). `requestReset` is enumeration-resistant: it
 * always resolves the same way whether or not the email has an account, and
 * email-send failures are logged rather than surfaced. `resetPassword` verifies
 * a single-use token, rotates the password, and revokes every session.
 */

/** Start a reset. Silent on unknown emails and on transport failure. */
export async function requestReset(emailInput: string): Promise<void> {
  await connectToDatabase();

  const email = emailInput.toLowerCase().trim();
  const user = await User.findOne({ email }).lean();
  if (!user) return;

  const rawToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL * 1000);
  await PasswordReset.create({
    userId: user._id,
    tokenHash: sha256Hex(rawToken),
    expiresAt,
  });

  try {
    await sendPasswordReset({ to: email, token: rawToken });
  } catch (err) {
    // Keep the response generic; the user can request another link.
    logger.error({ err }, "Password reset email failed to send");
  }
}

/**
 * Complete a reset: verify the token (unused + unexpired), set the new password,
 * bump tokenVersion, mark the token used, revoke all sessions, and send a
 * confirmation email (best-effort).
 */
export async function resetPassword(input: {
  token: string;
  password: string;
}): Promise<void> {
  await connectToDatabase();

  const tokenHash = sha256Hex(input.token);
  const record = await PasswordReset.findOne({ tokenHash });
  const invalid = !record || record.usedAt || record.expiresAt.getTime() <= Date.now();
  if (!record || invalid) {
    throw ApiError.badRequest("This reset link is invalid or has expired.");
  }

  const user = await User.findById(record.userId);
  if (!user) {
    // Orphaned token (user deleted); treat as invalid.
    throw ApiError.badRequest("This reset link is invalid or has expired.");
  }

  user.passwordHash = await hashPassword(input.password);
  user.tokenVersion += 1;
  await user.save();

  record.usedAt = new Date();
  await record.save();

  await revokeAllForUser(user._id);

  try {
    await sendPasswordChanged({ to: user.email });
  } catch (err) {
    logger.warn({ err }, "Password-changed email failed to send");
  }
}
