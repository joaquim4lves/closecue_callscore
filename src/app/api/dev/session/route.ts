import { z } from "zod";
import { assertDevUser } from "@/lib/dev/directory";
import { withLoggedRoute } from "@/lib/http/handler";
import { parseJson } from "@/lib/http/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ userId: z.string().uuid() });

function sessionResponse(body: unknown, setCookie: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": setCookie,
    },
  });
}

export const POST = withLoggedRoute(async (req) => {
  const body = await parseJson(req, bodySchema);
  const user = await assertDevUser(body.userId);
  return sessionResponse(
    { ok: true, userId: user.id },
    `mock_user_id=${user.id}; Path=/; HttpOnly; SameSite=Lax`,
  );
});

export const DELETE = withLoggedRoute(async () => {
  return sessionResponse(
    { ok: true },
    "mock_user_id=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
  );
});
