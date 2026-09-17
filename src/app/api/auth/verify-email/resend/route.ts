import { withRoute } from "@/lib/errors";
import { json, parseBody, assertSameOrigin } from "@/lib/http";
import { resendVerificationSchema } from "@/lib/auth/schemas";
import { resendVerification } from "@/lib/services/auth.service";
import { enforceRateLimit, getClientIp } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Regenerate and resend the signup verification code (generic response).
export const POST = withRoute(async (req: Request) => {
  assertSameOrigin(req);
  const ip = getClientIp(req);
  await enforceRateLimit("auth-strict", ip);

  const { email } = await parseBody(req, resendVerificationSchema);
  await resendVerification(email);

  return json({ ok: true });
});
