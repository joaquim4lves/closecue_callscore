import type { CallSource, CallStatus, SegmentSpeaker } from "../db/schema";

export type { CallSource, CallStatus };

export type CallSummary = {
  id: string;
  orgId: string;
  sellerId: string;
  playbookId: string | null;
  title: string;
  source: CallSource;
  externalId: string | null;
  status: CallStatus;
  durationSec: number | null;
  consentRecordedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  audioStored: boolean;
};

export type CallSegment = {
  id: string;
  idx: number;
  tStartMs: number;
  tEndMs: number;
  speaker: SegmentSpeaker;
  text: string;
};

export type CallDetail = CallSummary & {
  transcriptProvider: string | null;
  segments: CallSegment[];
};

export type CallListResponse = {
  calls: CallSummary[];
  emptyWeek: { copyKey: "calls.empty_week"; copy: string } | null;
  connectSource: { copyKey: "calls.connect_source"; copy: string };
  ingestFailed: { copyKey: "calls.ingest_failed"; copy: string };
};
