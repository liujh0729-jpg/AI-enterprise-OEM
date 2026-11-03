import { resolveStatus } from "@/lib/status";

export function StatusBadge({
  domain,
  status,
  text,
}: {
  domain?: string;
  status?: string | null;
  text?: string;
}) {
  const spec = resolveStatus(domain, String(status || ""));
  return <span className={`badge badge-${spec.variant}`}>{text || spec.label}</span>;
}
