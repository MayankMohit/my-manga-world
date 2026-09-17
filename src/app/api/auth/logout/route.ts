import { withRoute } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/http";
import { getAuthContext } from "@/lib/auth/require-user";
import { revokeSession } from "@/lib/auth/session";
import { denyJti } from "@/lib/auth/denylist";
import { clearAuthCookies } from "@/lib/auth/cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute(async (req: Request) => {
  assertSameOrigin(req);

  const ctx = await getAuthContext();
  if (ctx) {
    await revokeSession(ctx.sessionId);
    const ttl = ctx.accessExp - Math.floor(Date.now() / 1000);
    await denyJti(ctx.jti, ttl);
  }

  await clearAuthCookies();
  return new Response(null, { status: 204 });
});
