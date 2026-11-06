export function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export function statusLabel(status: "draft" | "active" | "archived"): string {
  if (status === "active") return "Ativo";
  if (status === "draft") return "Rascunho";
  return "Arquivado";
}

export function roleLabel(role: "seller" | "manager"): string {
  return role === "manager" ? "Gestor" : "Vendedor";
}
