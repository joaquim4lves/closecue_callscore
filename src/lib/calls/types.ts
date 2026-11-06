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
  score: ScoreSummary | null;
};

export type ScoreSummary = {
  overall: number | null;
  badFlag: boolean;
  shortReason: string | null;
  status: "ok" | "failed";
  reviewedAt: string | null;
  playbookId: string | null;
  playbookVersion: number;
  stale: boolean;
};

export type ScoreEvidence = {
  id: string;
  text: string;
  speaker: CallSegment["speaker"];
};

export type ScorePhaseView = {
  phaseId: string;
  name: string;
  score: number;
  gap: string | null;
  adherence: "cumprida" | "parcial" | "falhou";
  evidence: ScoreEvidence[];
};

export type ScoreObjectionView = {
  objectionId: string;
  label: string;
  hit: boolean;
  score: number | null;
  evidence: ScoreEvidence[];
};

export type ScoreDetail = ScoreSummary & {
  phaseScores: ScorePhaseView[];
  objectionScores: ScoreObjectionView[];
  reasons: string[];
  errorMessage: string | null;
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
  scoreDetail: ScoreDetail | null;
  noneActive: boolean;
};

export type CallListResponse = {
  calls: CallSummary[];
  emptyWeek: { copyKey: "calls.empty_week"; copy: string } | null;
  connectSource: { copyKey: "calls.connect_source"; copy: string };
  ingestFailed: { copyKey: "calls.ingest_failed"; copy: string };
  noneActive: { copyKey: "playbook.none_active"; copy: string } | null;
  scoreFailed: { copyKey: "calls.score_failed"; copy: string };
};
