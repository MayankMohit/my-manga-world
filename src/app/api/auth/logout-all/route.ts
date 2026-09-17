import { withRoute } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/http";
import { requireAuth } from "@/lib/auth/require-user";
import { logoutEverywhere } from "@/lib/services/auth.service";
import { denyJti } from "@/lib/auth/denylist";
import { clearAuthCookies } from "@/lib/auth/cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requireAuth();

  await logoutEverywhere(ctx.user.id);
  const ttl = ctx.accessExp - Math.floor(Date.now() / 1000);
  await denyJti(ctx.jti, ttl);

  await clearAuthCookies();
  return new Response(null, { status: 204 });
});
