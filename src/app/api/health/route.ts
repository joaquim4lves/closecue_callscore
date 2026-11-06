import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { withLoggedRoute } from "@/lib/http/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLoggedRoute(async () => {
  try {
    await getDb().execute(sql`select 1 as ok`);
    return Response.json({ ok: true, service: "closecue-callscore", db: "up" });
  } catch {
    return Response.json({ ok: false, service: "closecue-callscore", db: "down" }, { status: 503 });
  }
});
