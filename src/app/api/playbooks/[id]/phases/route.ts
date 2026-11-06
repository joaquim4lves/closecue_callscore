import { getAuthContext } from "@/lib/auth/context";
import { withLoggedRoute } from "@/lib/http/handler";
import { parseJson } from "@/lib/http/parse";
import { phaseBodySchema } from "@/lib/playbooks/schemas";
import { createPhase } from "@/lib/playbooks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withLoggedRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await getAuthContext(req);
  const body = await parseJson(req, phaseBodySchema);
  const playbook = await createPhase(auth, id ?? "", body);
  return Response.json(playbook, { status: 201 });
});
