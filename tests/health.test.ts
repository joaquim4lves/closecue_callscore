import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/health/route";
import { invoke, readJson, resetDb } from "./helpers";

describe("health and request id", () => {
  beforeEach(resetDb);

  it("returns 200 without auth and logs the request id", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await invoke(GET, { path: "/api/health", requestId: "req-health-1" });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-health-1");
    expect(await readJson(response)).toMatchObject({ ok: true, service: "closecue-callscore", db: "up" });
    const lines = spy.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes("req-health-1") && line.includes("response"))).toBe(true);
    spy.mockRestore();
  });
});
