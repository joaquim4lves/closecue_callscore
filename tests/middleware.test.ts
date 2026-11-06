import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { readMockUserId } from "../src/lib/auth/mock-session";
import { middleware } from "../src/middleware";

describe("mock auth middleware", () => {
  it("reads the header before the cookie", () => {
    const headers = new Headers({
      "x-mock-user-id": "22222222-2222-4222-8222-222222222222",
      cookie: "mock_user_id=33333333-3333-4333-8333-333333333333",
    });
    expect(readMockUserId(headers)).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("returns 401 for a protected API call without a mock user", async () => {
    const response = await middleware(new NextRequest("http://127.0.0.1/api/playbooks"));
    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("lets a cookie through and leaves health public", async () => {
    const authed = await middleware(
      new NextRequest("http://127.0.0.1/api/playbooks", {
        headers: { cookie: "mock_user_id=22222222-2222-4222-8222-222222222222" },
      }),
    );
    expect(authed.status).not.toBe(401);

    const health = await middleware(new NextRequest("http://127.0.0.1/api/health"));
    expect(health.status).not.toBe(401);
    expect(health.headers.get("x-request-id")).toBeTruthy();

    const zoom = await middleware(new NextRequest("http://127.0.0.1/api/webhooks/zoom", { method: "POST" }));
    expect(zoom.status).not.toBe(401);
  });
});
