import { getAuthContext } from "@/lib/auth/context";
import { withLoggedRoute } from "@/lib/http/handler";
import { parseJson } from "@/lib/http/parse";
import { objectionBodySchema } from "@/lib/playbooks/schemas";
import { createObjection } from "@/lib/playbooks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withLoggedRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await getAuthContext(req);
  const body = await parseJson(req, objectionBodySchema);
  const playbook = await createObjection(auth, id ?? "", body);
  return Response.json(playbook, { status: 201 });
});
