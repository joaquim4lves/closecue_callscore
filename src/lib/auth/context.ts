import { asc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { memberships, organizations, users } from "../db/schema";
import { ApiError } from "../http/errors";
import { isUuid, readMockUserId } from "./mock-session";

export type AuthContext = {
  requestId: string;
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgName: string;
  role: "seller" | "manager";
};

export async function getAuthContext(req: Request): Promise<AuthContext> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const userId = readMockUserId(req.headers);
  if (!userId || !isUuid(userId)) {
    throw new ApiError(
      401,
      "unauthorized",
      "Missing mock user. Send the x-mock-user-id header or the mock_user_id cookie.",
    );
  }

  const rows = await getDb()
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      orgId: memberships.orgId,
      orgName: organizations.name,
      role: memberships.role,
    })
    .from(users)
    .leftJoin(memberships, eq(memberships.userId, users.id))
    .leftJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(users.id, userId))
    .orderBy(asc(memberships.createdAt));

  if (rows.length === 0) {
    throw new ApiError(401, "unauthorized", "Unknown mock user.");
  }

  const membership = rows.find((row) => row.orgId && row.orgName && row.role);
  if (!membership || !membership.orgId || !membership.orgName || !membership.role) {
    throw new ApiError(403, "no_membership", "User has no organization membership.");
  }

  return {
    requestId,
    userId: membership.userId,
    email: membership.email,
    name: membership.name,
    orgId: membership.orgId,
    orgName: membership.orgName,
    role: membership.role,
  };
}
