import { ProviderNotImplemented, type MeetingProvider, type ProviderEvent, type TranscriptSegmentInput } from "./types";
import { verifyZoomSignature } from "./zoom-signature";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function speakerOf(value: unknown): TranscriptSegmentInput["speaker"] {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (text === "seller" || text === "host") return "seller";
  if (text === "prospect" || text === "customer" || text === "participant") return "prospect";
  return "unknown";
}

function segmentsFromUnknown(value: unknown): TranscriptSegmentInput[] {
  if (!Array.isArray(value)) return [];
  const segments: TranscriptSegmentInput[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row || typeof row.text !== "string" || row.text.trim() === "") continue;
    const start = numberOf(row.start_ms ?? row.t_start_ms) ?? segments.length * 1000;
    const end = numberOf(row.end_ms ?? row.t_end_ms) ?? start + 1000;
    segments.push({
      idx: segments.length,
      tStartMs: start,
      tEndMs: Math.max(end, start),
      speaker: speakerOf(row.speaker),
      text: row.text.trim(),
    });
  }
  return segments;
}

function segmentsFromText(text: string): TranscriptSegmentInput[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => ({
      idx,
      tStartMs: idx * 1000,
      tEndMs: idx * 1000 + 1000,
      speaker: "unknown" as const,
      text: line,
    }));
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function dateOf(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export class ZoomProvider implements MeetingProvider {
  readonly id = "zoom" as const;

  verifySignature(rawBody: string, headers: Headers): boolean {
    return verifyZoomSignature(
      process.env.ZOOM_WEBHOOK_SECRET_TOKEN ?? "",
      headers.get("x-zm-request-timestamp"),
      headers.get("x-zm-signature"),
      rawBody,
    );
  }

  parseEvent(payload: unknown): ProviderEvent {
    const body = asRecord(payload);
    const event = typeof body?.event === "string" ? body.event : "";
    const envelope = asRecord(body?.payload);
    if (event === "endpoint.url_validation") {
      const plainToken = typeof envelope?.plainToken === "string" ? envelope.plainToken : "";
      if (!plainToken) return { type: "ignore", reason: "Zoom URL validation is missing plainToken." };
      return { type: "url_validation", plainToken };
    }
    if (event !== "recording.completed" && event !== "recording.transcript_completed") {
      return { type: "ignore", reason: `Zoom event ${event || "unknown"} is not ingested.` };
    }
    const object = asRecord(envelope?.object);
    if (!object) return { type: "ignore", reason: "Zoom payload has no meeting object." };
    const externalId = typeof object.uuid === "string" && object.uuid ? object.uuid : String(object.id ?? "");
    if (!externalId) return { type: "ignore", reason: "Zoom meeting has no id." };

    const transcriptRecord = asRecord(object.transcript);
    const inlineSegments = segmentsFromUnknown(
      transcriptRecord?.segments ?? object.transcript_segments,
    );
    const textSegments =
      inlineSegments.length > 0
        ? inlineSegments
        : typeof transcriptRecord?.text === "string"
          ? segmentsFromText(transcriptRecord.text)
          : typeof object.transcript_text === "string"
            ? segmentsFromText(object.transcript_text)
            : [];

    const audio = pickAudioFile(object.recording_files);
    const durationMinutes = numberOf(object.duration);
    return {
      type: "meeting",
      meeting: {
        externalId,
        title: typeof object.topic === "string" && object.topic.trim() ? object.topic.trim() : "Zoom",
        hostEmail: typeof object.host_email === "string" ? object.host_email : null,
        startedAt: dateOf(object.start_time),
        endedAt: dateOf(object.end_time),
        durationSec: numberOf(object.duration_sec) ?? (durationMinutes != null ? durationMinutes * 60 : null),
        audioUrl: audio?.url ?? null,
        audioContentType: audio?.contentType ?? null,
        transcript:
          textSegments.length > 0
            ? { provider: "zoom", segments: textSegments, raw: transcriptRecord ?? object.transcript_text }
            : null,
      },
    };
  }
}

function pickAudioFile(value: unknown): { url: string; contentType: string } | null {
  if (!Array.isArray(value)) return null;
  const files = value
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item != null);
  const ranked = [...files].sort((left, right) => audioRank(left) - audioRank(right));
  for (const file of ranked) {
    if (audioRank(file) === 9) continue;
    const url = typeof file.download_url === "string" ? file.download_url : typeof file.play_url === "string" ? file.play_url : "";
    if (!url) continue;
    return { url, contentType: contentTypeOf(file) };
  }
  return null;
}

function audioRank(file: Record<string, unknown>): number {
  const type = `${file.file_type ?? ""} ${file.recording_type ?? ""}`.toLowerCase();
  if (type.includes("transcript")) return 9;
  if (type.includes("audio_only") || type.includes("m4a")) return 0;
  if (type.includes("audio")) return 1;
  if (type.includes("mp4") || type.includes("video")) return 2;
  return 3;
}

function contentTypeOf(file: Record<string, unknown>): string {
  const type = String(file.file_type ?? "").toUpperCase();
  if (type === "M4A") return "audio/mp4";
  if (type === "MP4") return "video/mp4";
  return "application/octet-stream";
}

function stub(provider: "meet" | "fireflies"): MeetingProvider {
  return {
    id: provider,
    verifySignature(): boolean {
      throw new ProviderNotImplemented(provider);
    },
    parseEvent(): ProviderEvent {
      throw new ProviderNotImplemented(provider);
    },
  };
}

export const zoomProvider = new ZoomProvider();
export const meetProvider = stub("meet");
export const firefliesProvider = stub("fireflies");
