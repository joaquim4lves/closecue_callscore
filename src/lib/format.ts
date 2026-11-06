import { copy } from "./copy";

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

export function sourceLabel(source: "upload" | "paste" | "meet" | "zoom" | "fireflies"): string {
  return copy[`calls.source.${source}`];
}

export function callStatusLabel(status: "pending" | "processing" | "ready" | "failed"): string {
  if (status === "pending") return "Pendente";
  if (status === "processing") return "Processando";
  if (status === "ready") return "Pronta";
  return "Falhou";
}
