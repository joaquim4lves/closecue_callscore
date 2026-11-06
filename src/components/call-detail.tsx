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
