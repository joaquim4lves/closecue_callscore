"use client";

import { useEffect, useState } from "react";
import { ApiClientError, api } from "@/components/api-client";
import { useSession } from "@/components/app-shell";
import { copy } from "@/lib/copy";

type CueSession = {
  id: string;
  status: "idle" | "live" | "ended";
  noneActive: boolean;
  playbookVersion: number | null;
};

type CueEvent = {
  id: string;
  kind: string;
  phaseId: string | null;
  objectionId: string | null;
  payload: { name?: string; label?: string; cue?: string; script?: string; gap?: string; adherence?: string };
  acknowledgedAt: string | null;
  dismissedAt: string | null;
};

export function OverlayPanel() {
  const { ready, me } = useSession();
  const [session, setSession] = useState<CueSession | null>(null);
  const [events, setEvents] = useState<CueEvent[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(false);
  const [reconnect, setReconnect] = useState(0);

  async function refresh(id: string) {
    const body = await api<{ events: CueEvent[] }>(`/api/cue-sessions/${id}/events`);
    setEvents(body.events);
  }

  useEffect(() => {
    if (!session || session.status === "ended") return;
    const source = new EventSource(`/api/cue-sessions/${session.id}/stream`);
    source.onopen = () => setOffline(false);
    source.onerror = () => setOffline(true);
    source.addEventListener("events", () => {
      void refresh(session.id);
    });
    const poll = window.setInterval(() => {
      if (source.readyState === EventSource.CLOSED) {
        void refresh(session.id);
      }
    }, 3000);
    return () => {
      source.close();
      window.clearInterval(poll);
    };
  }, [session?.id, session?.status, reconnect]);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const created = await api<CueSession>("/api/cue-sessions", { method: "POST", body: JSON.stringify({}) });
      setSession(created);
      setEvents([]);
      setOffline(false);
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : "Não foi possível iniciar.");
    } finally {
      setPending(false);
    }
  }

  async function end() {
    if (!session) return;
    setPending(true);
    try {
      setSession(await api<CueSession>(`/api/cue-sessions/${session.id}/end`, { method: "POST" }));
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : "Não foi possível encerrar.");
    } finally {
      setPending(false);
    }
  }

  async function tick(body: { text?: string; simulate?: "phase" | "objection" }) {
    if (!session) return;
    setPending(true);
    setError(null);
    try {
      const result = await api<{ session: CueSession; events: CueEvent[] }>(`/api/cue-sessions/${session.id}/ticks`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSession(result.session);
      await refresh(session.id);
      setText("");
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : "Não foi possível enviar o trecho.");
    } finally {
      setPending(false);
    }
  }

  async function mark(id: string, action: "ack" | "dismiss") {
    setPending(true);
    try {
      await api(`/api/cue-events/${id}/${action}`, { method: "POST" });
      if (session) await refresh(session.id);
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : "Não foi possível atualizar o cue.");
    } finally {
      setPending(false);
    }
  }

  if (!ready) return <p className="muted">Carregando…</p>;
  if (!me) return <section className="panel">Escolha um usuário mock no topo.</section>;

  const visible = [...events].reverse().find((event) => (event.kind === "phase" || event.kind === "objection") && !event.dismissedAt);
  const waiting = !session || session.status === "ended";
  const live = session?.status === "live" && !offline;

  return (
    <section className="panel overlay-card">
      <header>
        <p className="muted">CloseCue</p>
        <h1>Overlay</h1>
        <p className="meta-row">
          <span className="badge">
            {waiting ? copy["status.no_audio"] : live ? copy["status.in_call"] : copy["status.ready"]}
          </span>
          {session?.playbookVersion != null ? <span>v{session.playbookVersion}</span> : null}
        </p>
      </header>
      {error ? <p className="error">{error}</p> : null}
      {offline && session && session.status !== "ended" ? (
        <p className="offline" role="status">
          Conexão perdida.
          <button type="button" onClick={() => setReconnect((value) => value + 1)}>
            {copy["action.retry_audio"]}
          </button>
        </p>
      ) : null}
      {session?.noneActive ? (
        <p className="callout" role="status">
          {copy["playbook.none_active"]} <a href="/">Abrir playbooks</a>
        </p>
      ) : null}
      {waiting ? (
        <p role="status">{copy["status.no_audio"]}</p>
      ) : null}
      {visible ? (
        <article className="cue-card">
          <p className="muted">{visible.kind === "objection" ? `Objeção: ${visible.payload.label ?? ""}` : visible.payload.name}</p>
          <strong>{visible.payload.cue}</strong>
          {visible.payload.script ? <p>{visible.payload.script}</p> : null}
          {visible.acknowledgedAt ? <p className="muted">Visto</p> : null}
          <div className="footer-actions">
            <button type="button" onClick={() => void mark(visible.id, "ack")} disabled={pending || Boolean(visible.acknowledgedAt)}>
              {copy["overlay.ack"]}
            </button>
            <button type="button" className="ghost" onClick={() => void mark(visible.id, "dismiss")} disabled={pending}>
              {copy["overlay.dismiss"]}
            </button>
          </div>
        </article>
      ) : null}
      {session && session.status !== "ended" && !session.noneActive ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void tick({ text });
          }}
        >
          <label>
            Simular fala
            <textarea aria-label="Trecho da call" rows={3} value={text} onChange={(event) => setText(event.target.value)} />
          </label>
          <div className="footer-actions">
            <button type="submit" disabled={pending || !text.trim()}>
              Enviar trecho
            </button>
            <button type="button" className="ghost" disabled={pending} onClick={() => void tick({ simulate: "phase" })}>
              Simular tick
            </button>
            <button type="button" className="ghost" disabled={pending} onClick={() => void tick({ simulate: "objection" })}>
              Simular objeção
            </button>
          </div>
        </form>
      ) : null}
      <div className="footer-actions">
        {waiting ? (
          <button type="button" className="primary" onClick={() => void start()} disabled={pending}>
            Iniciar
          </button>
        ) : (
          <button type="button" onClick={() => void end()} disabled={pending}>
            Encerrar
          </button>
        )}
      </div>
    </section>
  );
}
