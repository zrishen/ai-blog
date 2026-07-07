import {
  ChevronRight,
  ChevronLeft,
  Plus,
  MessageSquare,
  Database,
  WandSparkles,
  Brain,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listResearchTopics } from "../../../api/client";
import { useChat } from "../../../stores/chatStore";
import { nextAiSidebarMode } from "./constants";

interface AISidebarHeaderProps {
  isPrivate: boolean;
  sidebarView: "list" | "chat";
  currentModeLabel: string;
  onCollapse: () => void;
  onBackToList: () => void;
  onNewChat: () => void;
}

export function AISidebarHeader({
  isPrivate,
  sidebarView,
  currentModeLabel,
  onCollapse,
  onBackToList,
  onNewChat,
}: AISidebarHeaderProps) {
  const { state, dispatch } = useChat();

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
                className="h-7 gap-1.5 rounded-full px-2.5 text-xs font-medium border-primary/25 bg-primary/8 text-primary hover:bg-primary/15 hover:border-primary/40 shadow-sm"
              >
                {state.aiSidebarMode === "normal" ? (
                  <MessageSquare className="h-3 w-3" />
                ) : state.aiSidebarMode === "knowledge" ? (
                  <Database className="h-3 w-3" />
                ) : (
                  <WandSparkles className="h-3 w-3" />
                )}
                {currentModeLabel}
                {state.aiSidebarThinkingMode === "deep" && (
                  <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-48">
              <DropdownMenuItem
                onClick={() =>
                  dispatch({
                    type: "SET_AI_SIDEBAR_MODE",
                    payload: nextAiSidebarMode[state.aiSidebarMode],
                  })
                }
              >
                {state.aiSidebarMode === "normal" ? (
                  <MessageSquare className="mr-2 h-4 w-4" />
                ) : state.aiSidebarMode === "knowledge" ? (
                  <Database className="mr-2 h-4 w-4" />
                ) : (
                  <WandSparkles className="mr-2 h-4 w-4" />
                )}
                {currentModeLabel}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  dispatch({
                    type: "SET_AI_SIDEBAR_THINKING_MODE",
                    payload: state.aiSidebarThinkingMode === "deep" ? "normal" : "deep",
                  })
                }
              >
                <Brain className="mr-2 h-4 w-4" />
                深度思考
                {state.aiSidebarThinkingMode === "deep" && (
                  <span className="ml-auto text-primary">✓</span>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  const next = !state.trustWritingEnabled;
                  dispatch({ type: "SET_TRUST_WRITING_ENABLED", payload: next });
                  if (next) {
                    try {
                      const topics = await listResearchTopics();
                      dispatch({ type: "SET_RESEARCH_TOPICS", payload: topics });
                    } catch {
                      /* topics will be fetched on demand later */
                    }
                  }
                }}
              >
                <Search className="mr-2 h-4 w-4" />
                研究写作
                {state.trustWritingEnabled && <span className="ml-auto text-primary">✓</span>}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {isPrivate && sidebarView === "chat" ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-full bg-background/70 px-3 text-xs"
            onClick={onBackToList}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            返回
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-8 rounded-full px-3 text-xs shadow-md shadow-primary/15"
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
