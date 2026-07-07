import { Badge } from "@/components/ui/badge";

interface RunStatusBadgeProps {
  status: string;
}

export function RunStatusBadge({ status }: RunStatusBadgeProps) {
  if (status === "completed" || status === "done") return <Badge className="rounded-full bg-emerald-600 text-white">已完成</Badge>;
  if (status === "running" || status === "processing") return <Badge className="rounded-full bg-primary text-primary-foreground">运行中</Badge>;
  if (status === "failed" || status === "error") return <Badge variant="outline" className="rounded-full border-destructive/25 bg-destructive/10 text-destructive">失败</Badge>;
  if (status === "pending" || status === "queued") return <Badge variant="outline" className="rounded-full">排队中</Badge>;
  return <Badge variant="outline" className="rounded-full">{status}</Badge>;
}
