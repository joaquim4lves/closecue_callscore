"use client";

import { useEffect, useState } from "react";
import { ApiClientError, api } from "@/components/api-client";
import { useSession } from "@/components/app-shell";
import { copy } from "@/lib/copy";
import { callStatusLabel, formatWhen, sourceLabel } from "@/lib/format";
import type { CallDetail } from "@/lib/calls/types";

export function CallDetailView({ id }: { id: string }) {
  const { ready, me } = useSession();
  const [call, setCall] = useState<CallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState(false);

  async function load() {
    try {
      setCall(await api<CallDetail>(`/api/calls/${id}`));
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 404) setMissing(true);
      else setError(reason instanceof Error ? reason.message : "Não foi possível abrir a call.");
    }
  }

  useEffect(() => {
    if (!ready || !me) return;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, me?.userId, id]);

  async function rescore() {
    setPending(true);
    setError(null);
    try {
      setCall(await api<CallDetail>(`/api/calls/${id}/rescore`, { method: "POST" }));
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : "Não foi possível pontuar de novo.");
    } finally {
      setPending(false);
    }
  }

  async function markReviewed() {
    setPending(true);
    setError(null);
    try {
      setCall(await api<CallDetail>(`/api/calls/${id}/review`, { method: "POST" }));
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : "Não foi possível marcar como revisada.");
    } finally {
      setPending(false);
    }
  }

  async function reprocess() {
    setPending(true);
    setError(null);
    try {
      setCall(await api<CallDetail>(`/api/calls/${id}/reprocess`, { method: "POST" }));
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : "Não foi possível reprocessar.");
    } finally {
      setPending(false);
    }
  }

  if (!ready) return <p className="muted">Carregando…</p>;
  if (!me) return <section className="panel">Escolha um usuário mock no topo.</section>;
  if (missing) return <section className="panel">Call não encontrada neste workspace.</section>;
  if (!call) return <p className="muted">Carregando call…</p>;

  return (
    <section className="panel">
      <a className="text-link" href="/calls">
        Calls
      </a>
      <div className="panel-head">
        <div>
          <h1>{call.title}</h1>
          <p className="meta-row">
            <span className="badge">{sourceLabel(call.source)}</span>
            <span>{callStatusLabel(call.status)}</span>
            <span>{formatWhen(call.startedAt ?? call.createdAt)}</span>
          </p>
        </div>
        {me.role === "manager" && call.status !== "ready" ? (
          <button type="button" onClick={() => void reprocess()} disabled={pending}>
            Reprocessar
          </button>
        ) : null}
      </div>
      {call.status === "failed" ? <p className="callout">{copy["calls.ingest_failed"]}</p> : null}
      {call.noneActive && !call.score ? (
        <p className="callout" role="status">
          {copy["playbook.none_active"]} <a href="/">Abrir playbooks</a>
        </p>
      ) : null}
      {call.score?.status === "failed" ? (
        <p className="callout" role="status">
          {copy["calls.score_failed"]}
          {me.role === "manager" ? (
            <button type="button" onClick={() => void rescore()} disabled={pending}>
              {copy["calls.retry_score"]}
            </button>
          ) : null}
        </p>
      ) : null}
      {call.scoreDetail?.status === "ok" ? (
        <div className="score-block">
          <p className="score-number">{call.scoreDetail.overall}</p>
          <p className="meta-row">
            {call.scoreDetail.badFlag ? <span className="badge">Ruim</span> : <span className="badge">OK</span>}
            {call.scoreDetail.reviewedAt ? <span>{copy["calls.reviewed"]}</span> : null}
            {call.scoreDetail.stale ? <span>Playbook mudou desde este score</span> : null}
          </p>
          <ul>
            {call.scoreDetail.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <h2>Fases</h2>
          {call.scoreDetail.phaseScores.map((phase) => (
            <article key={phase.phaseId}>
              <strong>
                {phase.name} · {phase.adherence} · {phase.score}
              </strong>
              {phase.gap ? <p className="muted">{phase.gap}</p> : null}
              {phase.evidence.map((item) => (
                <blockquote key={item.id}>{item.text}</blockquote>
              ))}
            </article>
          ))}
          <h2>Objeções</h2>
          {call.scoreDetail.objectionScores.length === 0 ? <p className="muted">Sem objeções no playbook.</p> : null}
          {call.scoreDetail.objectionScores.map((item) => (
            <article key={item.objectionId}>
              <strong>
                {item.label} · {item.hit ? "detectada" : "não detectada"}
                {item.score != null ? ` · ${item.score}` : ""}
              </strong>
              {item.evidence.map((evidence) => (
                <blockquote key={evidence.id}>{evidence.text}</blockquote>
              ))}
            </article>
          ))}
          {me.role === "manager" && !call.scoreDetail.reviewedAt ? (
            <button type="button" className="primary" onClick={() => void markReviewed()} disabled={pending}>
              {copy["calls.mark_reviewed"]}
            </button>
          ) : null}
          {me.role === "manager" && call.scoreDetail.stale ? (
            <button type="button" onClick={() => void rescore()} disabled={pending}>
              Atualizar score
            </button>
          ) : null}
        </div>
      ) : null}
      {call.errorMessage ? <p className="muted">{call.errorMessage}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <h2>Transcrição</h2>
      {call.segments.length ? (
        <ol className="item-list">
          {call.segments.map((segment) => (
            <li key={segment.id}>
              <span className="badge">{segment.speaker}</span>
              <span>{segment.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Sem segmentos ainda.</p>
      )}
    </section>
  );
}
