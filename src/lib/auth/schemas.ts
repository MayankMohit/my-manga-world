import { z } from "zod";
import { PASSWORD_MIN_LENGTH, VERIFICATION_CODE_LENGTH } from "@/lib/shared/constants";

/**
 * Zod schemas for auth requests. Kept free of server/node imports so the same
 * shapes can validate on the client (signup/login forms) without pulling server
 * code into the browser bundle. `.strict()` rejects unexpected keys.
 */

const email = z.email().max(254).toLowerCase().trim();
const password = z.string().min(PASSWORD_MIN_LENGTH).max(200);

export const signupSchema = z
  .object({
    email,
    password,
    name: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    password: z.string().min(1).max(200),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: password,
  })
  .strict();

const code = z
  .string()
  .trim()
  .regex(
    new RegExp(`^\\d{${VERIFICATION_CODE_LENGTH}}$`),
    "Enter the code from your email",
  );

export const verifyEmailSchema = z.object({ email, code }).strict();

export const resendVerificationSchema = z.object({ email }).strict();

export const forgotPasswordSchema = z.object({ email }).strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1).max(500),
    password,
  })
  .strict();

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
