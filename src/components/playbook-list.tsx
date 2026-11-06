"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, api } from "@/components/api-client";
import { useSession } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { copy } from "@/lib/copy";
import { formatWhen } from "@/lib/format";
import type { PlaybookDetail, PlaybookListResponse } from "@/lib/playbooks/types";

export function PlaybookList() {
  const router = useRouter();
  const { ready, me } = useSession();
  const [data, setData] = useState<PlaybookListResponse | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!ready || !me) return;
    const timer = window.setTimeout(() => {
      void api<PlaybookListResponse>("/api/playbooks")
        .then(setData)
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : "Não foi possível carregar os playbooks.");
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ready, me]);

  async function createPlaybook(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const created = await api<PlaybookDetail>("/api/playbooks", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      router.push(`/playbooks/${created.id}`);
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : "Não foi possível criar o playbook.");
      setPending(false);
    }
  }

  if (!ready) return <p className="muted">Carregando…</p>;
  if (!me) {
    return (
      <section className="panel">
        <h1>Playbooks</h1>
        <p>Escolha um usuário mock no topo. Se a lista estiver vazia, rode o seed.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h1>Playbooks</h1>
          <p className="lede">Uma versão ativa por workspace. Rascunho não entra no score.</p>
        </div>
      </div>

      {data?.noneActive ? (
        <p className="callout" role="status">
          {data.noneActive.copy}
          {me.role === "seller" ? " Peça a um gestor para publicar." : null}
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}

      {me.role === "manager" ? (
        <form className="create-row" onSubmit={createPlaybook}>
          <input
            aria-label="Nome do playbook"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome do playbook"
            required
            maxLength={160}
          />
          <button type="submit" disabled={pending}>
            Novo playbook
          </button>
        </form>
      ) : null}

      <table className="list">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Status</th>
            <th>Versão</th>
            <th>Atualizado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data?.playbooks.length ? (
            data.playbooks.map((playbook) => (
              <tr key={playbook.id}>
                <td>{playbook.name}</td>
                <td>
                  <StatusPill status={playbook.status} />
                </td>
                <td>v{playbook.version}</td>
                <td>{formatWhen(playbook.updatedAt)}</td>
                <td>
                  <a className="text-link" href={`/playbooks/${playbook.id}`}>
                    Abrir
                  </a>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="muted">
                {data ? copy["playbook.none_active"] : "Carregando playbooks…"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
