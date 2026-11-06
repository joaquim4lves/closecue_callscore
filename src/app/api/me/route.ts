import { getAuthContext } from "@/lib/auth/context";
import { withLoggedRoute } from "@/lib/http/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLoggedRoute(async (req) => {
  const auth = await getAuthContext(req);
  return Response.json({
    userId: auth.userId,
    email: auth.email,
    name: auth.name,
    orgId: auth.orgId,
    orgName: auth.orgName,
    role: auth.role,
    auth: "mock",
  });
});
