import type { TranscriptSegmentInput } from "./types";

export type SttInput = {
  audioUrl: string;
  contentType: string | null;
  callId: string;
};

export type SttResult = {
  provider: string;
  segments: TranscriptSegmentInput[];
  raw?: unknown;
};

export interface BatchSpeechToText {
  readonly provider: string;
  transcribe(input: SttInput): Promise<SttResult>;
}

export class MockSpeechToText implements BatchSpeechToText {
  readonly provider = "mock";
  readonly calls: SttInput[] = [];

  async transcribe(input: SttInput): Promise<SttResult> {
    this.calls.push(input);
    return {
      provider: "mock",
      segments: [
        {
          idx: 0,
          tStartMs: 0,
          tEndMs: 1000,
          speaker: "unknown",
          text: `Transcrição automática (mock).`,
        },
      ],
      raw: { audioUrl: input.audioUrl },
    };
  }
}

export class FailingSpeechToText implements BatchSpeechToText {
  readonly provider = "fail";
  readonly calls: SttInput[] = [];

  async transcribe(input: SttInput): Promise<SttResult> {
    this.calls.push(input);
    throw new Error("STT provider failed.");
  }
}

let override: BatchSpeechToText | null = null;

export function setSpeechToTextForTests(engine: BatchSpeechToText | null): void {
  override = engine;
}

export function getSpeechToText(): BatchSpeechToText {
  if (override) return override;
  const mode = process.env.STT_PROVIDER ?? "mock";
  if (mode === "fail") return new FailingSpeechToText();
  if (mode === "mock") return new MockSpeechToText();
  throw new Error(`Unknown STT_PROVIDER "${mode}". Use mock or fail.`);
}
