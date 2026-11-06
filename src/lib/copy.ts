/** Product copy for fatia 1. Keys are stable; Portuguese is the UI string. */
export const copy = {
  "playbook.publish": "Publicar",
  "playbook.save_draft": "Salvar rascunho",
  "playbook.replace_active": "Publicar e substituir o playbook ativo?",
  "playbook.none_active": "Publique um playbook para pontuar calls",
} as const;

export type CopyKey = keyof typeof copy;
