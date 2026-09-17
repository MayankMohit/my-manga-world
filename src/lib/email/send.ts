import "server-only";
import { resend } from "@/lib/email/resend";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  verificationCodeEmail,
  welcomeEmail,
  passwordResetEmail,
  passwordChangedEmail,
  type EmailContent,
} from "@/lib/email/templates";

/**
 * High-level transactional email senders. Each builds a template and hands it to
 * Resend. `sendEmail` throws when Resend reports an error so callers can decide
 * whether the failure should block the request (verification code) or merely be
 * logged (welcome, confirmation). Codes, tokens, and links are never logged.
 */

const appUrl = env.APP_URL.replace(/\/$/, "");

async function sendEmail(to: string, content: EmailContent): Promise<void> {
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });
  if (error) {
    // Log the failure metadata only (never the body/code/token).
    logger.error({ err: error, subject: content.subject }, "Email send failed");
    throw new Error(`Email send failed: ${error.message}`);
  }
}

export async function sendVerificationCode(input: {
  to: string;
  code: string;
  name?: string;
}): Promise<void> {
  await sendEmail(
    input.to,
    verificationCodeEmail({
      code: input.code,
      name: input.name,
      ttlMinutes: Math.round(env.EMAIL_VERIFICATION_TTL / 60),
    }),
  );
}

export async function sendWelcome(input: { to: string; name?: string }): Promise<void> {
  await sendEmail(input.to, welcomeEmail({ name: input.name, appUrl }));
}

export async function sendPasswordReset(input: {
  to: string;
  token: string;
}): Promise<void> {
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(input.token)}`;
  await sendEmail(
    input.to,
    passwordResetEmail({
      resetUrl,
      ttlMinutes: Math.round(env.PASSWORD_RESET_TTL / 60),
    }),
  );
}

export async function sendPasswordChanged(input: { to: string }): Promise<void> {
  await sendEmail(input.to, passwordChangedEmail({ appUrl }));
}
