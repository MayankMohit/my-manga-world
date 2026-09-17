/**
 * Shared enums and constants used by both the Next.js app and the worker.
 * This file must not import anything server-only or Next-specific.
 */

export const READING_MODES = ["vertical", "single", "double"] as const;
export type ReadingMode = (typeof READING_MODES)[number];

export const DIRECTIONS = ["rtl", "ltr"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const FITS = ["width", "height", "original"] as const;
export type Fit = (typeof FITS)[number];

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export const USER_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const MEMBER_ROLES = ["owner", "reader"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const CHAPTER_STATUS = ["queued", "processing", "ready", "failed"] as const;
export type ChapterStatus = (typeof CHAPTER_STATUS)[number];

export const SOURCE_FORMATS = ["zip", "rar", "7z", "pdf", "epub", "images"] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];

export const RENDER_MODES = ["images", "document"] as const;
export type RenderMode = (typeof RENDER_MODES)[number];

export const DOCUMENT_FORMATS = ["pdf", "epub"] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

export const UPLOAD_STATUS = [
  "pending",
  "processing",
  "done",
  "failed",
  "aborted",
] as const;
export type UploadStatus = (typeof UPLOAD_STATUS)[number];

/** Minimum password length, enforced at both validation and hashing layers. */
export const PASSWORD_MIN_LENGTH = 12;

/** Length of the numeric email-verification code (shared by codegen, schema, UI). */
export const VERIFICATION_CODE_LENGTH = 6;

/** Redis key namespace. Bump when the cache schema changes. */
export const CACHE_PREFIX = "shelf:v1";

/** BullMQ queue names, shared by producer (app) and consumer (worker). */
export const QUEUE_NAMES = {
  ingest: "ingest",
  cleanup: "cleanup",
  maintenance: "maintenance",
} as const;
