import { STATUS, type StatusKey } from "@/server/domain/status";
import { Badge } from "./ui/misc";

export function StatusBadge({ status }: { status: StatusKey }) {
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
