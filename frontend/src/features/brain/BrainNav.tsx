import { Boxes, Clock, Heart, Network, type LucideIcon } from "lucide-react";

import type { BrainTab } from "@/stores/types";

import { useChat } from "@/stores/chatStore";
import { useAuth } from "@/stores/authStore";
import { WorkspacePanel } from "@/components/ui/workspace-panel";
import { cn } from "@/lib/utils";

// AI 大脑左栏（控制台）：视图导航 + 概览统计。
// tab/stats 进 chatStore，与主区 BrainPage 兄弟共享。
const BRAIN_TABS: Array<{ key: BrainTab; label: string; icon: LucideIcon }> = [
  { key: "graph", label: "知识图谱", icon: Network },
  { key: "entities", label: "实体", icon: Boxes },
  { key: "episodes", label: "记忆", icon: Clock },
  { key: "preferences", label: "偏好", icon: Heart },
];

type StatField = "entities" | "facts" | "episodes" | "preferences";

// 概览 2×2：事实无独立 tab，点击跳 entities（事实挂在实体详情下）。
const STATS_CELLS: Array<{ label: string; field: StatField; goto: BrainTab }> = [
  { label: "实体", field: "entities", goto: "entities" },
  { label: "事实", field: "facts", goto: "entities" },
  { label: "记忆", field: "episodes", goto: "episodes" },
  { label: "偏好", field: "preferences", goto: "preferences" },
];

export function BrainNav() {
  const { state, dispatch } = useChat();
  const { isAuthenticated } = useAuth();
  const stats = state.brainStats;
  const enabled = stats?.enabled ?? false;

  if (!isAuthenticated) {
    return <WorkspacePanel className="overflow-y-auto select-none" />;
  }

  return (
    <WorkspacePanel className="overflow-y-auto select-none">
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <nav aria-label="AI 大脑视图" className="flex flex-col">
          {BRAIN_TABS.map(({ key, label, icon: Icon }) => {
            const active = state.brainTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => dispatch({ type: "SET_BRAIN_TAB", payload: key })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-body transition-colors",
                  active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent",
                )}
              >
                <Icon className={cn("h-4 w-4 flex-shrink-0", active && "text-primary")} />
                <span className="flex-1 truncate text-left">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="my-1.5 border-t border-border" />

        <div className="px-2 pb-1 pt-0.5">
          <span className="text-meta font-semibold text-muted-foreground">概览</span>
        </div>
        <div className={cn("grid grid-cols-2 gap-2", stats && !enabled && "opacity-60")}>
          {STATS_CELLS.map(({ label, field, goto }) => (
            <button
              key={field}
              type="button"
              onClick={() => dispatch({ type: "SET_BRAIN_TAB", payload: goto })}
              className="flex flex-col items-start rounded-panel border border-border/60 bg-card/60 p-3 text-left transition-colors hover:bg-accent"
            >
              <span className="text-body-lg font-black text-foreground">
                {stats ? stats[field] : "—"}
              </span>
              <span className="text-caption text-muted-foreground">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </WorkspacePanel>
  );
}
