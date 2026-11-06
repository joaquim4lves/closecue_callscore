import type { SegmentSpeaker } from "../db/schema";

export type TranscriptSegmentInput = {
  idx: number;
  tStartMs: number;
  tEndMs: number;
  speaker: SegmentSpeaker;
  text: string;
};

export type NormalizedMeeting = {
  externalId: string;
  title: string;
  hostEmail: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSec: number | null;
  audioUrl: string | null;
  audioContentType: string | null;
  transcript: {
    provider: string;
    segments: TranscriptSegmentInput[];
    raw?: unknown;
  } | null;
};

export type ProviderEvent =
  | { type: "url_validation"; plainToken: string }
  | { type: "ignore"; reason: string }
  | { type: "meeting"; meeting: NormalizedMeeting };

export interface MeetingProvider {
  readonly id: "zoom" | "meet" | "fireflies";
  verifySignature(rawBody: string, headers: Headers): boolean;
  parseEvent(payload: unknown): ProviderEvent;
}

export class ProviderNotImplemented extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super(`${provider} is a typed stub. Production ingest is Zoom only.`);
    this.name = "ProviderNotImplemented";
    this.provider = provider;
  }
}
