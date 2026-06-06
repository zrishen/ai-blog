import { Search } from "lucide-react";
import type { ResearchTopicDetail } from "../../stores/chatStore";

interface TrustContextIndicatorProps {
  enabled: boolean;
  topic: ResearchTopicDetail | null;
}

function statusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    draft: "草稿",
    researching: "研究中",
    reviewing: "待审核",
    ready: "已确认",
    stale: "可能过期",
    archived: "已归档",
  };
  return status ? labels[status] ?? status : "待建立";
}

export function TrustContextIndicator({ enabled, topic }: TrustContextIndicatorProps) {
  if (!enabled) return null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Search className="h-3 w-3 flex-shrink-0 text-primary" />
      <span className="truncate">
        研究写作：{topic?.title || "当前写作主题"} · {statusLabel(topic?.status)}
      </span>
    </div>
  );
}
