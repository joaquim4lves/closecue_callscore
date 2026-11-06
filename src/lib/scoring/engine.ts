export type ScorePhaseInput = {
  id: string;
  name: string;
  checklistItems: string[];
};

export type ScoreObjectionInput = {
  id: string;
  label: string;
  signals: string[];
  suggestedResponse: string;
};

export type ScoreSegmentInput = {
  id: string;
  text: string;
};

export type PhaseScore = {
  phaseId: string;
  name: string;
  score: number;
  gap: string | null;
  adherence: "cumprida" | "parcial" | "falhou";
  evidenceSegmentIds: string[];
};

export type ObjectionScore = {
  objectionId: string;
  label: string;
  hit: boolean;
  score: number | null;
  evidenceSegmentIds: string[];
};

export type ScoreDraft = {
  overall: number;
  badFlag: boolean;
  shortReason: string;
  phaseScores: PhaseScore[];
  objectionScores: ObjectionScore[];
  reasons: string[];
  model: string;
  promptVersion: string;
};

export type ScoreRequest = {
  phases: ScorePhaseInput[];
  objections: ScoreObjectionInput[];
  segments: ScoreSegmentInput[];
  badBelow: number;
};

export interface CallScorer {
  readonly provider: string;
  score(input: ScoreRequest): Promise<ScoreDraft>;
}

function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function needlesOf(value: string): string[] {
  const folded = fold(value).trim();
  if (folded.length >= 4) return [folded];
  return [];
}

function evidenceFor(segments: ScoreSegmentInput[], needles: string[]): string[] {
  if (needles.length === 0) return [];
  return segments
    .filter((segment) => {
      const text = fold(segment.text);
      return needles.some((needle) => text.includes(needle));
    })
    .map((segment) => segment.id);
}

function adherence(score: number): PhaseScore["adherence"] {
  if (score >= 80) return "cumprida";
  if (score >= 50) return "parcial";
  return "falhou";
}

function clamp(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Deterministic rules scorer. Useful in demo and tests. Not a coaching model. */
export class RulesCallScorer implements CallScorer {
  readonly provider = "mock";

  async score(input: ScoreRequest): Promise<ScoreDraft> {
    const transcript = input.segments.map((segment) => fold(segment.text)).join("\n");
    const phaseScores = input.phases.map((phase) => {
      const checklist = phase.checklistItems.length > 0 ? phase.checklistItems : [phase.name];
      const usable = checklist.map((item) => needlesOf(item)[0]).filter((item): item is string => Boolean(item));
      const matched = usable.filter((needle) => transcript.includes(needle));
      const score = usable.length === 0 ? 100 : clamp((matched.length / usable.length) * 100);
      return {
        phaseId: phase.id,
        name: phase.name,
        score,
        gap: score < input.badBelow ? `${phase.name} incompleta` : null,
        adherence: adherence(score),
        evidenceSegmentIds: evidenceFor(input.segments, matched),
      };
    });

    const objectionScores = input.objections.map((objection) => {
      const signals = objection.signals.flatMap((signal) => needlesOf(signal));
      const matchedSignals = signals.filter((signal) => transcript.includes(signal));
      const hit = matchedSignals.length > 0;
      const responseWords = fold(objection.suggestedResponse)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length >= 5);
      const answered = hit && responseWords.some((word) => transcript.includes(word));
      const score = !hit ? null : answered ? 100 : 20;
      return {
        objectionId: objection.id,
        label: objection.label,
        hit,
        score,
        evidenceSegmentIds: evidenceFor(input.segments, matchedSignals),
      };
    });

    const parts = [
      ...phaseScores.map((phase) => phase.score),
      ...objectionScores.flatMap((item) => (item.score == null ? [] : [item.score])),
    ];
    const overall = parts.length === 0 ? 100 : clamp(parts.reduce((sum, score) => sum + score, 0) / parts.length);
    const objectionGap = objectionScores.some((item) => item.hit && item.score != null && item.score < input.badBelow);
    const badFlag = overall < input.badBelow || objectionGap;
    const reasons = [
      ...phaseScores.flatMap((phase) => (phase.gap ? [phase.gap] : [])),
      ...objectionScores.flatMap((item) => (item.hit && item.score != null && item.score < input.badBelow ? [`${item.label} sem resposta`] : [])),
    ].slice(0, 3);
    if (reasons.length === 0) reasons.push("Aderente ao playbook");
    return {
      overall,
      badFlag,
      shortReason: reasons[0] ?? "Aderente ao playbook",
      phaseScores,
      objectionScores,
      reasons,
      model: "rules-mock",
      promptVersion: "fatia3-v1",
    };
  }
}

export class FailingCallScorer implements CallScorer {
  readonly provider = "fail";

  async score(): Promise<ScoreDraft> {
    throw new Error("Score provider failed.");
  }
}

let override: CallScorer | null = null;

export function setCallScorerForTests(scorer: CallScorer | null): void {
  override = scorer;
}

export function getCallScorer(): CallScorer {
  if (override) return override;
  const mode = process.env.SCORE_PROVIDER ?? "mock";
  if (mode === "fail") return new FailingCallScorer();
  if (mode === "mock") return new RulesCallScorer();
  throw new Error(`Unknown SCORE_PROVIDER "${mode}". Use mock or fail.`);
}
