import { getAuthContext } from "@/lib/auth/context";
import { withLoggedRoute } from "@/lib/http/handler";
import { parseJson } from "@/lib/http/parse";
import { reorderSchema } from "@/lib/playbooks/schemas";
import { reorderObjections } from "@/lib/playbooks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withLoggedRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await getAuthContext(req);
  const body = await parseJson(req, reorderSchema);
  return Response.json(await reorderObjections(auth, id ?? "", body.orderedIds));
});
