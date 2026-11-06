/** Product copy. Keys are stable; Portuguese is the UI string. */
export const copy = {
  "playbook.publish": "Publicar",
  "playbook.save_draft": "Salvar rascunho",
  "playbook.replace_active": "Publicar e substituir o playbook ativo?",
  "playbook.none_active": "Publique um playbook para pontuar calls",
  "calls.source.meet": "Meet",
  "calls.source.zoom": "Zoom",
  "calls.source.fireflies": "Fireflies",
  "calls.source.upload": "Upload",
  "calls.source.paste": "Colar",
  "calls.ingest_failed": "Não recebemos esta call — tente o upload",
  "calls.connect_source": "Conectar Meet/Zoom/Fireflies",
  "calls.empty_week": "Ainda não há calls scored esta semana",
  "calls.bad_chip": "Ruins",
  "calls.reviewed": "Revisada",
  "calls.mark_reviewed": "Marquei como revisada",
  "calls.score_failed": "Não foi possível pontuar esta call",
  "calls.retry_score": "Tentar de novo",
} as const;

export type CopyKey = keyof typeof copy;
