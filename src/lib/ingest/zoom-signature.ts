import crypto from "node:crypto";

const MAX_SKEW_MS = 5 * 60 * 1000;

export function zoomSignature(secret: string, timestamp: string, rawBody: string): string {
  const digest = crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  return `v0=${digest}`;
}

export function zoomEncryptedToken(secret: string, plainToken: string): string {
  return crypto.createHmac("sha256", secret).update(plainToken).digest("hex");
}

export function verifyZoomSignature(
  secret: string,
  timestamp: string | null,
  signature: string | null,
  rawBody: string,
  now = Date.now(),
): boolean {
  if (!secret || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  if (Math.abs(now - seconds * 1000) > MAX_SKEW_MS) return false;
  const expected = zoomSignature(secret, timestamp, rawBody);
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function hashWebhookHeaders(headers: Headers): string {
  const material = ["x-zm-request-timestamp", "x-zm-signature", "authorization"]
    .map((name) => `${name}:${headers.get(name) ?? ""}`)
    .join("\n");
  return crypto.createHash("sha256").update(material).digest("hex");
}
