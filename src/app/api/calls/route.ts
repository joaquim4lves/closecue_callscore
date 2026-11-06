import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { createManualCall, listCalls } from "@/lib/calls/service";
import { withLoggedRoute } from "@/lib/http/handler";
import { ApiError } from "@/lib/http/errors";
import { parseJson } from "@/lib/http/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sourceSchema = z.enum(["upload", "paste", "meet", "zoom", "fireflies"]);
const pasteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  transcript: z.string().trim().min(1).max(100000),
  sellerId: z.string().uuid().optional(),
  consentRecordedAt: z.string().datetime().optional(),
});

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function parseConsent(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, "invalid_request", "consentRecordedAt must be a date.");
  }
  return date;
}

export const GET = withLoggedRoute(async (req) => {
  const auth = await getAuthContext(req);
  const url = new URL(req.url);
  const sourceRaw = url.searchParams.get("source");
  const periodRaw = url.searchParams.get("period");
  const sellerId = url.searchParams.get("sellerId") ?? undefined;
  const source = sourceRaw ? sourceSchema.safeParse(sourceRaw) : null;
  if (source && !source.success) throw new ApiError(400, "invalid_request", "Unknown source filter.");
  if (periodRaw && periodRaw !== "week") throw new ApiError(400, "invalid_request", "period must be week.");
  const result = await listCalls(auth, {
    source: source?.success ? source.data : undefined,
    period: periodRaw === "week" ? "week" : undefined,
    sellerId,
  });
  return Response.json(result);
});

export const POST = withLoggedRoute(async (req) => {
  const auth = await getAuthContext(req);
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const title = String(form.get("title") ?? "").trim();
    const transcriptRaw = String(form.get("transcript") ?? "").trim();
    const sellerRaw = String(form.get("sellerId") ?? "").trim();
    const consentRaw = String(form.get("consentRecordedAt") ?? "").trim();
    const consentRecordedAt = parseConsent(consentRaw);
    const audio = form.get("audio");
    if (!title) throw new ApiError(400, "invalid_request", "Title is required.");
    let audioRef: { url: string; contentType: string } | null = null;
    if (audio instanceof File && audio.size > 0) {
      if (audio.size > MAX_AUDIO_BYTES) throw new ApiError(413, "audio_too_large", "Audio file is larger than 25MB.");
      const type = audio.type || "application/octet-stream";
      if (!type.startsWith("audio/") && !type.startsWith("video/") && type !== "application/octet-stream") {
        throw new ApiError(400, "invalid_audio", "Upload an audio or video file.");
      }
      audioRef = { url: `upload://${encodeURIComponent(audio.name || "audio")}`, contentType: type };
    }
    const created = await createManualCall(auth, {
      title,
      transcript: transcriptRaw || null,
      sellerId: sellerRaw || undefined,
      consentRecordedAt,
      audio: audioRef,
    });
    return Response.json(created, { status: 201 });
  }
  const body = await parseJson(req, pasteSchema);
  const created = await createManualCall(auth, {
    title: body.title,
    transcript: body.transcript,
    sellerId: body.sellerId,
    consentRecordedAt: body.consentRecordedAt ? new Date(body.consentRecordedAt) : null,
    audio: null,
  });
  return Response.json(created, { status: 201 });
});
