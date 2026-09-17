import { withRoute } from "@/lib/errors";
import { json } from "@/lib/http";
import { requireAuth } from "@/lib/auth/require-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute(async () => {
  const { user } = await requireAuth();
  return json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});
