import { getAuthContext } from "@/lib/auth/context";
import { withLoggedRoute } from "@/lib/http/handler";
import { parseJson } from "@/lib/http/parse";
import { updatePlaybookSchema } from "@/lib/playbooks/schemas";
import { deletePlaybook, getPlaybook, updatePlaybook } from "@/lib/playbooks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLoggedRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await getAuthContext(req);
  return Response.json(await getPlaybook(auth, id ?? ""));
});

export const PATCH = withLoggedRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await getAuthContext(req);
  const body = await parseJson(req, updatePlaybookSchema);
  return Response.json(await updatePlaybook(auth, id ?? "", body));
});

export const DELETE = withLoggedRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await getAuthContext(req);
  await deletePlaybook(auth, id ?? "");
  return new Response(null, { status: 204 });
});
