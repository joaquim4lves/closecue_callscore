import type { ObjectionScore, PhaseScore, ScorePhaseInput, ScoreRequest, ScoreSegmentInput } from "../scoring/engine";

export type PhaseMatchDetail = {
  phaseId: string;
  name: string;
  script: string;
  triggerText: string;
  unmatched: string[];
};

export type AdherenceMatch = {
  phaseScores: PhaseScore[];
  objectionScores: ObjectionScore[];
  phaseDetail: PhaseMatchDetail[];
};

export function fold(value: string): string {
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

/** Shared phase/objection matcher used by CallScore and the CloseCue overlay. */
export function matchAdherence(input: ScoreRequest & { phases: ScorePhaseInput[] }): AdherenceMatch {
  const transcript = input.segments.map((segment) => fold(segment.text)).join("\n");
  const phaseDetail: PhaseMatchDetail[] = [];
  const phaseScores = input.phases.map((phase) => {
    const checklist = phase.checklistItems.length > 0 ? phase.checklistItems : [phase.name];
    const paired = checklist.map((item) => ({ item, needle: needlesOf(item)[0] ?? "" }));
    const usable = paired.filter((entry) => entry.needle);
    const matched = usable.filter((entry) => transcript.includes(entry.needle));
    const score = usable.length === 0 ? 100 : clamp((matched.length / usable.length) * 100);
    phaseDetail.push({
      phaseId: phase.id,
      name: phase.name,
      script: phase.script ?? "",
      triggerText: phase.triggerText ?? "",
      unmatched: usable.filter((entry) => !transcript.includes(entry.needle)).map((entry) => entry.item),
    });
    return {
      phaseId: phase.id,
      name: phase.name,
      score,
      gap: score < input.badBelow ? `${phase.name} incompleta` : null,
      adherence: adherence(score),
      evidenceSegmentIds: evidenceFor(
        input.segments,
        matched.map((entry) => entry.needle),
      ),
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

  return { phaseScores, objectionScores, phaseDetail };
}

export function currentCue(match: AdherenceMatch, badBelow: number) {
  const objection = match.objectionScores.find((item) => item.hit && item.score != null && item.score < badBelow);
  if (objection) return { kind: "objection" as const, objection };
  const phase = match.phaseScores.find((item) => item.adherence !== "cumprida");
  if (phase) return { kind: "phase" as const, phase, detail: match.phaseDetail.find((item) => item.phaseId === phase.phaseId) };
  return { kind: "clear" as const };
}
