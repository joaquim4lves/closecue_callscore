import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";
import { getDb } from "../src/lib/db/client";
import { memberships, organizations, users } from "../src/lib/db/schema";
import type { RouteContext } from "../src/lib/http/handler";

type Handler = (req: Request, ctx: RouteContext) => Promise<Response>;

export async function resetDb(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE cue_events, cue_sessions, scores, transcript_segments, transcripts, calls, webhook_inbox, retention_policies, playbook_objections, playbook_phases, playbooks, memberships, users, organizations RESTART IDENTITY CASCADE`,
  );
}

export async function seedOrg(label: string) {
  const db = getDb();
  const [org] = await db.insert(organizations).values({ name: label }).returning();
  const [manager] = await db
    .insert(users)
    .values({ email: `${label}-manager@test.local`, name: `${label} manager` })
    .returning();
  const [seller] = await db
    .insert(users)
    .values({ email: `${label}-seller@test.local`, name: `${label} seller` })
    .returning();
  if (!org || !manager || !seller) throw new Error("fixture insert failed");
  await db.insert(memberships).values([
    { orgId: org.id, userId: manager.id, role: "manager" },
    { orgId: org.id, userId: seller.id, role: "seller" },
  ]);
  return { org, manager, seller };
}

export async function invoke(
  handler: Handler,
  options: {
    method?: string;
    path: string;
    userId?: string;
    cookieUserId?: string;
    body?: unknown;
    params?: Record<string, string>;
    requestId?: string;
  },
): Promise<Response> {
  const method = options.method ?? "GET";
  const headers = new Headers();
  const requestId = options.requestId ?? "req-test";
  headers.set("x-request-id", requestId);
  if (options.userId) headers.set("x-mock-user-id", options.userId);
  if (options.cookieUserId) headers.set("cookie", `mock_user_id=${options.cookieUserId}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const url = `http://127.0.0.1${options.path}`;
  const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;

  const mw = await middleware(new NextRequest(url, { method, headers, body }));
  if (mw.status === 401) return mw;

  const forwarded = new Headers(headers);
  if (!options.userId && options.cookieUserId) forwarded.set("x-mock-user-id", options.cookieUserId);
  const forwardedId = mw.headers.get("x-request-id");
  if (forwardedId) forwarded.set("x-request-id", forwardedId);
  return handler(new Request(url, { method, headers: forwarded, body }), {
    params: Promise.resolve(options.params ?? {}),
  });
}

export async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}
