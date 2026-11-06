const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Header wins over the dev cookie. Both are mock auth — there is no Clerk session. */
export function readMockUserId(headers: Headers): string | null {
  const fromHeader = headers.get("x-mock-user-id")?.trim();
  if (fromHeader) return fromHeader;

  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== "mock_user_id") continue;
    const raw = part.slice(separator + 1).trim();
    if (!raw) return null;
    try {
      const decoded = decodeURIComponent(raw).trim();
      return decoded || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function mockAuthDevRoutesEnabled(): boolean {
  return process.env.MOCK_AUTH !== "false";
}
