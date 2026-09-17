import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";

/**
 * Resend client singleton, cached on globalThis to survive Next.js hot reloads.
 * Isolated here so only `send.ts` (server-only) ever imports the SDK.
 */
const globalForResend = globalThis as unknown as { __shelfResend?: Resend };

export const resend: Resend =
  globalForResend.__shelfResend ?? new Resend(env.RESEND_API_KEY);

globalForResend.__shelfResend = resend;
