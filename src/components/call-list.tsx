"use client";

import { useEffect, useState } from "react";
import { ApiClientError, api } from "@/components/api-client";
import { useSession } from "@/components/app-shell";
import { copy } from "@/lib/copy";
import { callStatusLabel, formatWhen, sourceLabel } from "@/lib/format";
import type { CallListResponse, CallSource } from "@/lib/calls/types";

const sources: Array<CallSource | ""> = ["", "zoom", "meet", "fireflies", "upload", "paste"];

export function CallList() {
  const { ready, me, users } = useSession();
  const [source, setSource] = useState<CallSource | "">("");
  const [period, setPeriod] = useState<"week" | "">("week");
  const [sellerId, setSellerId] = useState("");
  const [data, setData] = useState<CallListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [pending, setPending] = useState(false);

  async function load(next?: { source?: CallSource | ""; period?: "week" | ""; sellerId?: string }) {
    const selectedSource = next?.source ?? source;
    const selectedPeriod = next?.period ?? period;
    const selectedSeller = next?.sellerId ?? sellerId;
    const params = new URLSearchParams();
    if (selectedSource) params.set("source", selectedSource);
    if (selectedPeriod) params.set("period", selectedPeriod);
    if (selectedSeller) params.set("sellerId", selectedSeller);
    const query = params.toString();
    setData(await api<CallListResponse>(`/api/calls${query ? `?${query}` : ""}`));
  }

  useEffect(() => {
    if (!ready || !me) return;
    const timer = window.setTimeout(() => {
      void load().catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Não foi possível carregar as calls.");
      });
    }, 0);
    return () => window.clearTimeout(timer);
    // Reload when the signed-in user changes. Filters reload through their own handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, me?.userId]);

  async function pasteCall(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("/api/calls", {
        method: "POST",
        body: JSON.stringify({
          title,
          transcript,
          sellerId: me?.role === "manager" && sellerId ? sellerId : undefined,
        }),
      });
      setTitle("");
      setTranscript("");
      await load();
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : "Não foi possível colar a call.");
    } finally {
      setPending(false);
    }
  }

  async function uploadCall(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const form = new FormData(event.currentTarget);
      if (me?.role === "manager" && sellerId) form.set("sellerId", sellerId);
      const response = await fetch("/api/calls", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new ApiClientError(response.status, body);
      event.currentTarget.reset();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar a gravação.");
    } finally {
      setPending(false);
    }
  }

  if (!ready) return <p className="muted">Carregando…</p>;
  if (!me) return <section className="panel">Escolha um usuário mock no topo.</section>;

  const sellers = users.filter((user) => user.orgId === me.orgId && user.role === "seller");

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h1>Calls</h1>
          <p className="lede">Webhook Zoom entra aqui. Upload e colar são o fallback de desenvolvimento.</p>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {data?.emptyWeek ? (
        <div className="callout" role="status">
          <p>{data.emptyWeek.copy}</p>
          <p>
            <a href="#enviar-gravacao">{copy["calls.connect_source"]}</a>
            {" · "}
            <a href="#enviar-gravacao">Enviar gravação</a>
          </p>
        </div>
      ) : null}

      <div className="filters">
        <label>
          Origem
          <select
            aria-label="Origem"
            value={source}
            onChange={(event) => {
              const value = event.target.value as CallSource | "";
              setSource(value);
              void load({ source: value });
            }}
          >
            {sources.map((item) => (
              <option key={item || "all"} value={item}>
                {item ? sourceLabel(item) : "Todas"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Período
          <select
            aria-label="Período"
            value={period}
            onChange={(event) => {
              const value = event.target.value as "week" | "";
              setPeriod(value);
              void load({ period: value });
            }}
          >
            <option value="week">Esta semana</option>
            <option value="">Tudo</option>
          </select>
        </label>
        {me.role === "manager" ? (
          <label>
            Vendedor
            <select
              aria-label="Vendedor"
              value={sellerId}
              onChange={(event) => {
                setSellerId(event.target.value);
                void load({ sellerId: event.target.value });
              }}
            >
              <option value="">Todos</option>
              {sellers.map((seller) => (
                <option key={seller.userId} value={seller.userId}>
                  {seller.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <table className="list">
        <thead>
          <tr>
            <th>Call</th>
            <th>Origem</th>
            <th>Status</th>
            <th>Quando</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data?.calls.length ? (
            data.calls.map((call) => (
              <tr key={call.id} className={call.status === "failed" ? "row-failed" : ""}>
                <td>{call.title}</td>
                <td>
                  <span className="badge">{sourceLabel(call.source)}</span>
                </td>
                <td>{callStatusLabel(call.status)}</td>
                <td>{formatWhen(call.startedAt ?? call.createdAt)}</td>
                <td>
                  <a className="text-link" href={`/calls/${call.id}`}>
                    Abrir
                  </a>
                  {call.status === "failed" ? <div className="muted">{copy["calls.ingest_failed"]}</div> : null}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="muted">
                {data?.emptyWeek?.copy ?? "Nenhuma call neste filtro."}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div id="enviar-gravacao" className="stack-form">
        <form onSubmit={pasteCall}>
          <label>
            Título
            <input aria-label="Título da call" value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label>
            Colar transcrição
            <textarea
              aria-label="Transcrição"
              rows={4}
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={pending}>
            Colar transcrição
          </button>
        </form>
        <form onSubmit={uploadCall}>
          <label>
            Título da gravação
            <input name="title" aria-label="Título da gravação" required />
          </label>
          <label>
            Áudio
            <input name="audio" aria-label="Arquivo de áudio" type="file" accept="audio/*,video/*" required />
          </label>
          <label>
            Transcrição opcional
            <textarea name="transcript" aria-label="Transcrição opcional" rows={3} />
          </label>
          <button type="submit" disabled={pending}>
            Enviar gravação
          </button>
        </form>
      </div>
    </section>
  );
}
