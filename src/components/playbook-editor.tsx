"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, api } from "@/components/api-client";
import { useSession } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { copy } from "@/lib/copy";
import { formatWhen } from "@/lib/format";
import type { Objection, Phase, PlaybookDetail } from "@/lib/playbooks/types";

type Tab = "phases" | "objections";

type ReplacePrompt = {
  copy?: string;
  activePlaybook?: { id: string; name: string; version: number };
};

export function PlaybookEditor({ id }: { id: string }) {
  const router = useRouter();
  const { ready, me } = useSession();
  const [playbook, setPlaybook] = useState<PlaybookDetail | null>(null);
  const [name, setName] = useState("");
  const [tab, setTab] = useState<Tab>("phases");
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [objectionId, setObjectionId] = useState<string | null>(null);
  const [phaseForm, setPhaseForm] = useState<Phase | null>(null);
  const [objectionForm, setObjectionForm] = useState<Objection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [replacePrompt, setReplacePrompt] = useState<ReplacePrompt | null>(null);
  const [missing, setMissing] = useState(false);

  function applyDetail(detail: PlaybookDetail, keepSelection = true) {
    const nextPhaseId =
      keepSelection && phaseId && detail.phases.some((phase) => phase.id === phaseId)
        ? phaseId
        : (detail.phases[0]?.id ?? null);
    const nextObjectionId =
      keepSelection && objectionId && detail.objections.some((item) => item.id === objectionId)
        ? objectionId
        : (detail.objections[0]?.id ?? null);
    setPlaybook(detail);
    setName(detail.name);
    setPhaseId(nextPhaseId);
    setObjectionId(nextObjectionId);
    setPhaseForm(detail.phases.find((phase) => phase.id === nextPhaseId) ?? null);
    setObjectionForm(detail.objections.find((item) => item.id === nextObjectionId) ?? null);
  }

  useEffect(() => {
    if (!ready || !me) return;
    const timer = window.setTimeout(() => {
      void api<PlaybookDetail>(`/api/playbooks/${id}`)
        .then((detail) => applyDetail(detail, false))
        .catch((reason: unknown) => {
          if (reason instanceof ApiClientError && reason.status === 404) setMissing(true);
          else setError(reason instanceof Error ? reason.message : "Não foi possível abrir o playbook.");
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ready, me, id]);

  const editable = me?.role === "manager" && playbook?.status === "draft";

  function selectPhase(nextId: string) {
    if (!playbook) return;
    setPhaseId(nextId);
    setPhaseForm(playbook.phases.find((phase) => phase.id === nextId) ?? null);
  }

  function selectObjection(nextId: string) {
    if (!playbook) return;
    setObjectionId(nextId);
    setObjectionForm(playbook.objections.find((item) => item.id === nextId) ?? null);
  }

  async function persistFields(): Promise<void> {
    if (!playbook || !editable) return;
    if (tab === "phases" && phaseForm) {
      await api(`/api/playbooks/${id}/phases/${phaseForm.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: phaseForm.name,
          triggerText: phaseForm.triggerText,
          script: phaseForm.script,
          checklistItems: phaseForm.checklistItems.map((item) => item.trim()).filter(Boolean),
        }),
      });
    }
    if (tab === "objections" && objectionForm) {
      await api(`/api/playbooks/${id}/objections/${objectionForm.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          label: objectionForm.label,
          signals: objectionForm.signals.map((item) => item.trim()).filter(Boolean),
          suggestedResponse: objectionForm.suggestedResponse,
        }),
      });
    }
  }

  async function saveDraft() {
    setError(null);
    setPending(true);
    try {
      await persistFields();
      const detail = await api<PlaybookDetail>(`/api/playbooks/${id}/save-draft`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      applyDetail(detail);
      setNotice("Rascunho salvo. O score continua no playbook ativo.");
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : "Não foi possível salvar o rascunho.");
    } finally {
      setPending(false);
    }
  }

  async function publish(replaceActive = false) {
    setError(null);
    setPending(true);
    try {
      await persistFields();
      await api(`/api/playbooks/${id}/save-draft`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      const detail = await api<PlaybookDetail>(`/api/playbooks/${id}/publish`, {
        method: "POST",
        body: JSON.stringify({ replaceActive }),
      });
      applyDetail(detail);
      setReplacePrompt(null);
      setNotice("Playbook publicado. Calls novas pontuam contra esta versão.");
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.body.error === "playbook.replace_active") {
        setReplacePrompt({
          copy: typeof reason.body.copy === "string" ? reason.body.copy : copy["playbook.replace_active"],
          activePlaybook: reason.body.activePlaybook as ReplacePrompt["activePlaybook"],
        });
      } else {
        setError(reason instanceof ApiClientError ? reason.message : "Não foi possível publicar.");
      }
    } finally {
      setPending(false);
    }
  }

  async function mutate(path: string, init: RequestInit) {
    setError(null);
    setPending(true);
    try {
      if (editable) await persistFields();
      const detail = await api<PlaybookDetail>(path, init);
      applyDetail(detail);
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : "Não foi possível atualizar.");
    } finally {
      setPending(false);
    }
  }

  async function duplicate() {
    setPending(true);
    setError(null);
    try {
      const detail = await api<PlaybookDetail>(`/api/playbooks/${id}/duplicate`, { method: "POST" });
      router.push(`/playbooks/${detail.id}`);
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : "Não foi possível criar o rascunho.");
      setPending(false);
    }
  }

  async function removePlaybook() {
    if (!window.confirm("Excluir este rascunho?")) return;
    setPending(true);
    try {
      await api(`/api/playbooks/${id}`, { method: "DELETE" });
      router.push("/");
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : "Não foi possível excluir.");
      setPending(false);
    }
  }

  if (!ready) return <p className="muted">Carregando…</p>;
  if (!me) return <p className="panel">Escolha um usuário mock no topo.</p>;
  if (missing) return <p className="panel">Playbook não encontrado neste workspace.</p>;
  if (!playbook) return <p className="muted">Carregando playbook…</p>;

  return (
    <section className="editor">
      <div className="panel-head">
        <div>
          <a className="text-link" href="/">
            Playbooks
          </a>
          <h1>{playbook.name}</h1>
          <p className="meta-row">
            <StatusPill status={playbook.status} />
            <span>v{playbook.version}</span>
            {playbook.publishedAt ? <span>Ativo desde {formatWhen(playbook.publishedAt)}</span> : null}
          </p>
        </div>
        {me.role === "manager" && playbook.status !== "draft" ? (
          <button type="button" onClick={() => void duplicate()} disabled={pending}>
            Editar como rascunho
          </button>
        ) : null}
      </div>

      {playbook.status === "draft" ? (
        <p className="callout">Este rascunho não entra no score até ser publicado.</p>
      ) : null}
      {notice ? <p className="notice">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="editor-grid">
        <aside>
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "phases"} onClick={() => setTab("phases")}>
              Fases
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "objections"}
              onClick={() => setTab("objections")}
            >
              Objeções
            </button>
          </div>
          {tab === "phases" ? (
            <ItemList
              items={playbook.phases.map((phase) => ({ id: phase.id, label: phase.name }))}
              selectedId={phaseId}
              onSelect={selectPhase}
              editable={Boolean(editable)}
              pending={pending}
              addLabel="Adicionar fase"
              onAdd={() =>
                void mutate(`/api/playbooks/${id}/phases`, {
                  method: "POST",
                  body: JSON.stringify({ name: "Nova fase" }),
                })
              }
              onMove={(index, direction) => {
                const ids = playbook.phases.map((phase) => phase.id);
                const target = index + direction;
                if (target < 0 || target >= ids.length) return;
                const next = [...ids];
                const [moved] = next.splice(index, 1);
                if (!moved) return;
                next.splice(target, 0, moved);
                void mutate(`/api/playbooks/${id}/phases/reorder`, {
                  method: "POST",
                  body: JSON.stringify({ orderedIds: next }),
                });
              }}
            />
          ) : (
            <ItemList
              items={playbook.objections.map((item) => ({ id: item.id, label: item.label }))}
              selectedId={objectionId}
              onSelect={selectObjection}
              editable={Boolean(editable)}
              pending={pending}
              addLabel="Adicionar objeção"
              onAdd={() =>
                void mutate(`/api/playbooks/${id}/objections`, {
                  method: "POST",
                  body: JSON.stringify({ label: "Nova objeção" }),
                })
              }
              onMove={(index, direction) => {
                const ids = playbook.objections.map((item) => item.id);
                const target = index + direction;
                if (target < 0 || target >= ids.length) return;
                const next = [...ids];
                const [moved] = next.splice(index, 1);
                if (!moved) return;
                next.splice(target, 0, moved);
                void mutate(`/api/playbooks/${id}/objections/reorder`, {
                  method: "POST",
                  body: JSON.stringify({ orderedIds: next }),
                });
              }}
            />
          )}
        </aside>

        <div className="editor-main">
          {editable ? (
            <label>
              Nome do playbook
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} />
            </label>
          ) : null}

          {tab === "phases" && phaseForm ? (
            <PhaseFields
              phase={phaseForm}
              editable={Boolean(editable)}
              onChange={setPhaseForm}
              onDelete={
                editable
                  ? () => void mutate(`/api/playbooks/${id}/phases/${phaseForm.id}`, { method: "DELETE" })
                  : undefined
              }
            />
          ) : null}
          {tab === "phases" && !phaseForm ? <p className="muted">Nenhuma fase ainda.</p> : null}

          {tab === "objections" && objectionForm ? (
            <ObjectionFields
              objection={objectionForm}
              editable={Boolean(editable)}
              onChange={setObjectionForm}
              onDelete={
                editable
                  ? () =>
                      void mutate(`/api/playbooks/${id}/objections/${objectionForm.id}`, { method: "DELETE" })
                  : undefined
              }
            />
          ) : null}
          {tab === "objections" && !objectionForm ? <p className="muted">Nenhuma objeção ainda.</p> : null}
        </div>
      </div>

      {editable ? (
        <footer className="editor-footer">
          <button type="button" className="ghost" onClick={() => void removePlaybook()} disabled={pending}>
            Excluir rascunho
          </button>
          <div className="footer-actions">
            <button type="button" onClick={() => void saveDraft()} disabled={pending}>
              {copy["playbook.save_draft"]}
            </button>
            <button type="button" className="primary" onClick={() => void publish(false)} disabled={pending}>
              {copy["playbook.publish"]}
            </button>
          </div>
        </footer>
      ) : null}

      {replacePrompt ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="replace-title">
            <h2 id="replace-title">{replacePrompt.copy ?? copy["playbook.replace_active"]}</h2>
            {replacePrompt.activePlaybook ? (
              <p>
                {replacePrompt.activePlaybook.name} v{replacePrompt.activePlaybook.version} deixa de ser o ativo.
                Calls novas passam a usar esta versão.
              </p>
            ) : null}
            <div className="footer-actions">
              <button type="button" className="ghost" onClick={() => setReplacePrompt(null)}>
                Cancelar
              </button>
              <button type="button" className="primary" onClick={() => void publish(true)} disabled={pending}>
                Publicar e substituir
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ItemList({
  items,
  selectedId,
  onSelect,
  editable,
  pending,
  addLabel,
  onAdd,
  onMove,
}: {
  items: { id: string; label: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  editable: boolean;
  pending: boolean;
  addLabel: string;
  onAdd: () => void;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  return (
    <div>
      <ul className="item-list">
        {items.map((item, index) => (
          <li key={item.id} className={item.id === selectedId ? "selected" : ""}>
            <button type="button" className="item-name" onClick={() => onSelect(item.id)}>
              {item.label}
            </button>
            {editable ? (
              <span className="nudge">
                <button type="button" aria-label={`Subir ${item.label}`} disabled={pending || index === 0} onClick={() => onMove(index, -1)}>
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Descer ${item.label}`}
                  disabled={pending || index === items.length - 1}
                  onClick={() => onMove(index, 1)}
                >
                  ↓
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {editable ? (
        <button type="button" className="ghost add" onClick={onAdd} disabled={pending}>
          {addLabel}
        </button>
      ) : null}
    </div>
  );
}

function PhaseFields({
  phase,
  editable,
  onChange,
  onDelete,
}: {
  phase: Phase;
  editable: boolean;
  onChange: (phase: Phase) => void;
  onDelete?: () => void;
}) {
  return (
    <div className="fields">
      <label>
        Nome da fase
        <input
          value={phase.name}
          disabled={!editable}
          onChange={(event) => onChange({ ...phase, name: event.target.value })}
        />
      </label>
      <label>
        Gatilho
        <input
          value={phase.triggerText}
          disabled={!editable}
          onChange={(event) => onChange({ ...phase, triggerText: event.target.value })}
        />
      </label>
      <label>
        Script
        <textarea
          rows={5}
          value={phase.script}
          disabled={!editable}
          onChange={(event) => onChange({ ...phase, script: event.target.value })}
        />
      </label>
      <fieldset disabled={!editable}>
        <legend>Pontos a cobrir</legend>
        {phase.checklistItems.map((item, index) => (
          <div className="inline-field" key={`${phase.id}-check-${index}`}>
            <input
              aria-label={`Ponto ${index + 1}`}
              value={item}
              onChange={(event) => {
                const checklistItems = [...phase.checklistItems];
                checklistItems[index] = event.target.value;
                onChange({ ...phase, checklistItems });
              }}
            />
            {editable ? (
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  onChange({
                    ...phase,
                    checklistItems: phase.checklistItems.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              >
                Remover
              </button>
            ) : null}
          </div>
        ))}
        {editable ? (
          <button
            type="button"
            className="ghost"
            onClick={() => onChange({ ...phase, checklistItems: [...phase.checklistItems, ""] })}
          >
            Adicionar ponto
          </button>
        ) : null}
      </fieldset>
      {onDelete ? (
        <button type="button" className="ghost" onClick={onDelete}>
          Excluir fase
        </button>
      ) : null}
    </div>
  );
}

function ObjectionFields({
  objection,
  editable,
  onChange,
  onDelete,
}: {
  objection: Objection;
  editable: boolean;
  onChange: (objection: Objection) => void;
  onDelete?: () => void;
}) {
  return (
    <div className="fields">
      <label>
        Rótulo
        <input
          value={objection.label}
          disabled={!editable}
          onChange={(event) => onChange({ ...objection, label: event.target.value })}
        />
      </label>
      <fieldset disabled={!editable}>
        <legend>Sinais</legend>
        {objection.signals.map((signal, index) => (
          <div className="inline-field" key={`${objection.id}-signal-${index}`}>
            <input
              aria-label={`Sinal ${index + 1}`}
              value={signal}
              onChange={(event) => {
                const signals = [...objection.signals];
                signals[index] = event.target.value;
                onChange({ ...objection, signals });
              }}
            />
            {editable ? (
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  onChange({
                    ...objection,
                    signals: objection.signals.filter((_, signalIndex) => signalIndex !== index),
                  })
                }
              >
                Remover
              </button>
            ) : null}
          </div>
        ))}
        {editable ? (
          <button
            type="button"
            className="ghost"
            onClick={() => onChange({ ...objection, signals: [...objection.signals, ""] })}
          >
            Adicionar sinal
          </button>
        ) : null}
      </fieldset>
      <label>
        Resposta sugerida
        <textarea
          rows={5}
          value={objection.suggestedResponse}
          disabled={!editable}
          onChange={(event) => onChange({ ...objection, suggestedResponse: event.target.value })}
        />
      </label>
      {onDelete ? (
        <button type="button" className="ghost" onClick={onDelete}>
          Excluir objeção
        </button>
      ) : null}
    </div>
  );
}
