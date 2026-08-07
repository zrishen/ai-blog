import {
  ChevronRight,
  ChevronLeft,
  Plus,
  Zap,
  Scale,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChat } from "../../../stores/chatStore";
import { thinkingModeLabels } from "./constants";
import type { ThinkingMode } from "../../../api/chat";

interface AISidebarHeaderProps {
  isPrivate: boolean;
  sidebarView: "list" | "chat";
  onCollapse: () => void;
  onBackToList: () => void;
  onNewChat: () => void;
  onThinkingModeChange: (mode: ThinkingMode) => void;
}

const THINKING_MODE_OPTIONS: { mode: ThinkingMode; label: string; icon: React.ReactNode; desc: string }[] = [
  { mode: "fast", label: "快速", icon: <Zap className="h-4 w-4" />, desc: "快速响应，适合简单问题" },
  { mode: "balanced", label: "平衡", icon: <Scale className="h-4 w-4" />, desc: "兼顾速度与质量（推荐）" },
  { mode: "smart", label: "智能", icon: <Sparkles className="h-4 w-4" />, desc: "深度思考，适合复杂任务" },
];

export function AISidebarHeader({
  isPrivate,
  sidebarView,
  onCollapse,
  onBackToList,
  onNewChat,
  onThinkingModeChange,
}: AISidebarHeaderProps) {
  const { state } = useChat();
  const supportsThinking = state.llmSupportsThinking;

  return (
    <div className="relative flex flex-shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-card/78 px-3 py-3 backdrop-blur-xl">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 flex-shrink-0 rounded-full text-muted-foreground hover:text-foreground"
        onClick={onCollapse}
        title="收起"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>

      <div className="ml-auto flex items-center gap-2">
        {isPrivate && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-full px-3 text-fine font-medium border-primary/25 bg-primary/8 text-primary hover:bg-primary/15 hover:border-primary/40 shadow-sm"
              >
                {state.aiSidebarThinkingMode === "smart" ? (
                  <Sparkles className="h-3 w-3" />
                ) : state.aiSidebarThinkingMode === "balanced" ? (
                  <Scale className="h-3 w-3" />
                ) : (
                  <Zap className="h-3 w-3" />
                )}
                {thinkingModeLabels[state.aiSidebarThinkingMode]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-52">
              <DropdownMenuLabel className="text-caption text-muted-foreground">思考模式</DropdownMenuLabel>
              {THINKING_MODE_OPTIONS.map((opt) => {
                const disabled = !supportsThinking && opt.mode !== "fast";
                const menuItem = (
                  <DropdownMenuItem
                    key={opt.mode}
                    disabled={disabled}
                    onClick={() => onThinkingModeChange(opt.mode)}
                  >
                    {opt.icon}
                    <span className="ml-2">{opt.label}</span>
                    {state.aiSidebarThinkingMode === opt.mode && (
                      <span className="ml-auto text-primary">✓</span>
                    )}
                  </DropdownMenuItem>
                );
                return disabled ? (
                  <TooltipProvider key={opt.mode} delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div>{menuItem}</div>
                      </TooltipTrigger>
                      <TooltipContent>该模型不支持深度思考</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  menuItem
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {isPrivate && sidebarView === "chat" ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-full bg-background/70 px-3 text-fine"
            onClick={onBackToList}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            返回
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-8 rounded-full px-3 text-fine shadow-md shadow-primary/15"
            onClick={onNewChat}
          >
            <Plus className="h-3.5 w-3.5" />
            新对话
          </Button>
        )}
      </div>
    </div>
  );
}
