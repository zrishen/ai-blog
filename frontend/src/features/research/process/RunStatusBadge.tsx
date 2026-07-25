import { Badge } from "@/components/ui/badge";

interface RunStatusBadgeProps {
  status: string;
}

export function RunStatusBadge({ status }: RunStatusBadgeProps) {
  if (status === "completed" || status === "done") return <Badge variant="success" className="rounded-full">已完成</Badge>;
  if (status === "running" || status === "processing") return <Badge className="rounded-full">运行中</Badge>;
  if (status === "failed" || status === "error") return <Badge variant="destructive" className="rounded-full">失败</Badge>;
  if (status === "pending" || status === "queued") return <Badge variant="secondary" className="rounded-full">排队中</Badge>;
  return <Badge variant="outline" className="rounded-full">{status}</Badge>;
}
