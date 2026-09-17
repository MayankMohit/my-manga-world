import { withRoute } from "@/lib/errors";
import { json, parseBody, assertSameOrigin } from "@/lib/http";
import { signupSchema } from "@/lib/auth/schemas";
import { startSignup } from "@/lib/services/auth.service";
import { enforceRateLimit, getClientIp } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step 1 of signup: validate, stash a pending verification, and email a code.
// The account is created only after POST /api/auth/verify-email.
export const POST = withRoute(async (req: Request) => {
  assertSameOrigin(req);
  const ip = getClientIp(req);
  await enforceRateLimit("auth-strict", ip);

  const body = await parseBody(req, signupSchema);
  const { email } = await startSignup(body);

  return json({ pending: true, email });
});
