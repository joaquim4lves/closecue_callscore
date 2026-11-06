import { getAuthContext } from "@/lib/auth/context";
import { withLoggedRoute } from "@/lib/http/handler";
import { parseJson } from "@/lib/http/parse";
import { createPlaybookSchema } from "@/lib/playbooks/schemas";
import { createPlaybook, listPlaybooks } from "@/lib/playbooks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLoggedRoute(async (req) => {
  const auth = await getAuthContext(req);
  return Response.json(await listPlaybooks(auth));
});

export const POST = withLoggedRoute(async (req) => {
  const auth = await getAuthContext(req);
  const body = await parseJson(req, createPlaybookSchema);
  const created = await createPlaybook(auth, body);
  return Response.json(created, { status: 201 });
});
