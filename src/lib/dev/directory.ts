import { asc, eq } from "drizzle-orm";
import { mockAuthDevRoutesEnabled } from "../auth/mock-session";
import { getDb } from "../db/client";
import { memberships, organizations, users } from "../db/schema";
import { ApiError } from "../http/errors";

export type DevUser = {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgName: string;
  role: "seller" | "manager";
};

function assertDevRoutes(): void {
  if (!mockAuthDevRoutesEnabled()) {
    throw new ApiError(404, "not_found", "Not found.");
  }
}

export async function listDevUsers(): Promise<DevUser[]> {
  assertDevRoutes();
  const rows = await getDb()
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      orgId: organizations.id,
      orgName: organizations.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .orderBy(asc(organizations.name), asc(users.name));
  return rows;
}

export async function assertDevUser(userId: string): Promise<{ id: string }> {
  assertDevRoutes();
  const [user] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) throw new ApiError(404, "not_found", "Unknown user.");
  return user;
}
