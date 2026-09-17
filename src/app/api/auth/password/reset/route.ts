import { withRoute } from "@/lib/errors";
import { json, parseBody, assertSameOrigin } from "@/lib/http";
import { resetPasswordSchema } from "@/lib/auth/schemas";
import { resetPassword } from "@/lib/services/password-reset.service";
import { enforceRateLimit, getClientIp } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Complete a password reset using the emailed token.
export const POST = withRoute(async (req: Request) => {
  assertSameOrigin(req);
  const ip = getClientIp(req);
  await enforceRateLimit("auth-strict", ip);

  const body = await parseBody(req, resetPasswordSchema);
  await resetPassword(body);

  return json({ ok: true });
});
