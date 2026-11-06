import { statusLabel } from "@/lib/format";

export function StatusPill({ status }: { status: "draft" | "active" | "archived" }) {
  return <span className={`pill pill-${status}`}>{statusLabel(status)}</span>;
}
