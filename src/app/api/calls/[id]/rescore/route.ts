import { getAuthContext } from "@/lib/auth/context";
import { getCall } from "@/lib/calls/service";
import { withLoggedRoute } from "@/lib/http/handler";
import { rescoreCall } from "@/lib/scoring/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withLoggedRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await getAuthContext(req);
  await rescoreCall(auth, id ?? "");
  return Response.json(await getCall(auth, id ?? ""));
});
