import { z } from "zod";

/**
 * Environment validation. Fails fast at startup with a clear message when a
 * required variable is missing or malformed. Imported by the Next.js app and,
 * via `lib/shared`, by the worker process.
 */

const port = z.coerce.number().int().min(1).max(65535);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    APP_URL: z.url(),

    MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
    REDIS_URL: z.string().min(1, "REDIS_URL is required"),

    JWT_ACCESS_SECRET: z
      .string()
      .min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    JWT_REFRESH_SECRET: z
      .string()
      .min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
    JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2592000),

    R2_ACCOUNT_ID: z.string().min(1, "R2_ACCOUNT_ID is required"),
    R2_ACCESS_KEY_ID: z.string().min(1, "R2_ACCESS_KEY_ID is required"),
    R2_SECRET_ACCESS_KEY: z.string().min(1, "R2_SECRET_ACCESS_KEY is required"),
    R2_BUCKET: z.string().min(1, "R2_BUCKET is required"),

    PRESIGN_UPLOAD_TTL: z.coerce.number().int().positive().default(900),
    PRESIGN_DOWNLOAD_TTL: z.coerce.number().int().positive().default(3600),

    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(1073741824),
    MAX_UNCOMPRESSED_BYTES: z.coerce.number().int().positive().default(2147483648),
    MAX_ENTRIES: z.coerce.number().int().positive().default(5000),
    MAX_STORAGE_BYTES_PER_USER: z.coerce.number().int().positive().default(21474836480),

    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),

    // Shelf-specific additions (see PLAN.md section 15).
    // Signup is open/self-serve (email-verified); invites are series-scoped only
    // (no app-level signup gating). INVITE_TTL bounds series invite link validity.
    INVITE_TTL: z.coerce.number().int().positive().default(604800),
    BOOTSTRAP_ADMIN_EMAIL: z
      .email()
      .optional()
      .or(z.literal("").transform(() => undefined)),

    // Transactional email (Resend). RESEND_API_KEY is required so signup
    // verification and password reset always work. EMAIL_FROM defaults to the
    // Resend sandbox sender (dev only); production needs a verified domain.
    RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
    // Empty or unset falls back to the Resend sandbox sender (dev only).
    EMAIL_FROM: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v : undefined),
      z.string().default("Shelf <onboarding@resend.dev>"),
    ),
    EMAIL_VERIFICATION_TTL: z.coerce.number().int().positive().default(600),
    PASSWORD_RESET_TTL: z.coerce.number().int().positive().default(3600),
    // Unclaimed anonymous-upload retention (used by the Phase 3 upload pipeline).
    ANON_UPLOAD_TTL: z.coerce.number().int().positive().default(172800),

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .optional(),

    APP_PORT: port.default(3000),
  })
  .superRefine((val, ctx) => {
    if (val.JWT_ACCESS_SECRET === val.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_REFRESH_SECRET"],
        message: "JWT_REFRESH_SECRET must be different from JWT_ACCESS_SECRET",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parse an arbitrary source (defaults to process.env). Throws on failure. */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

/** Validated environment, evaluated once at module load (fail fast). */
export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
