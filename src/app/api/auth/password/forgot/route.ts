import { withRoute } from "@/lib/errors";
import { json, parseBody, assertSameOrigin } from "@/lib/http";
import { forgotPasswordSchema } from "@/lib/auth/schemas";
import { requestReset } from "@/lib/services/password-reset.service";
import { enforceRateLimit, getClientIp } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Request a password reset link. Always generic (no account enumeration).
export const POST = withRoute(async (req: Request) => {
  assertSameOrigin(req);
  const ip = getClientIp(req);
  await enforceRateLimit("auth-strict", ip);

  const { email } = await parseBody(req, forgotPasswordSchema);
  await requestReset(email);

  return json({ ok: true });
});
