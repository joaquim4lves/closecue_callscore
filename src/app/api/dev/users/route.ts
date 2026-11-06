import { listDevUsers } from "@/lib/dev/directory";
import { withLoggedRoute } from "@/lib/http/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLoggedRoute(async () => {
  const users = await listDevUsers();
  return Response.json({ users, auth: "mock" });
});
