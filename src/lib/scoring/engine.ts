import { matchAdherence } from "../adherence/match";

export type ScorePhaseInput = {
  id: string;
  name: string;
  checklistItems: string[];
  script?: string;
  triggerText?: string;
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

/** Deterministic rules scorer. Useful in demo and tests. Not a coaching model. */
export class RulesCallScorer implements CallScorer {
  readonly provider = "mock";

  async score(input: ScoreRequest): Promise<ScoreDraft> {
    const { phaseScores, objectionScores } = matchAdherence(input);
    const parts = [
      ...phaseScores.map((phase) => phase.score),
      ...objectionScores.flatMap((item) => (item.score == null ? [] : [item.score])),
    ];
    const mean = parts.reduce((sum, score) => sum + score, 0) / parts.length;
    const overall = parts.length === 0 ? 100 : Math.max(0, Math.min(100, Math.round(mean)));
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
