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
} as const;

export type CopyKey = keyof typeof copy;
