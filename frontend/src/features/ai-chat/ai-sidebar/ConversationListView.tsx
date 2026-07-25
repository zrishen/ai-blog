import { motion, AnimatePresence } from "motion/react";
import {
  ChevronRight,
  Sparkles,
  MessageSquare,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { surfaceVariants } from "@/lib/visualVariants";
import { cn } from "@/lib/utils";
import type { AISidebarConversationKey } from "../../../stores/chatStore";
import { formatDate } from "./messageHelpers";

export interface ConversationListItem {
  key: AISidebarConversationKey;
  id: number | null;
  title: string;
  created_at: string;
  selected: boolean;
  streaming: boolean;
  error: string | null;
  isTemp: boolean;
}

interface ConversationListViewProps {
  conversations: ConversationListItem[];
  error: string | null;
  onSelect: (item: ConversationListItem) => void;
  onDeleteRequest: (item: ConversationListItem, e: React.MouseEvent) => void;
  onDismissError: () => void;
}

export function ConversationListView({
  conversations,
  error,
  onSelect,
  onDeleteRequest,
  onDismissError,
}: ConversationListViewProps) {
  return (
    <ScrollArea className="relative min-h-0 flex-1">
      <div className="flex flex-col gap-3 p-3">
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, maxHeight: 0 }}
              animate={{ opacity: 1, maxHeight: 80 }}
              exit={{ opacity: 0, maxHeight: 0 }}
              className="flex items-center gap-2 bg-destructive/10 text-destructive py-2 px-3 rounded-xl text-[13px] overflow-hidden"
            >
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="flex-1">{error}</span>
              <button
                className="flex-shrink-0 text-destructive/70 hover:text-destructive"
                onClick={onDismissError}
              >
                <ChevronRight className="w-3.5 h-3.5 rotate-90" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {conversations.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-5 text-center">
            <div>
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-panel bg-primary/10 text-primary ring-1 ring-primary/15">
                <Sparkles className="h-6 w-6" />
              </div>
              <p className="text-base font-black tracking-[-0.04em] text-foreground">还没有对话</p>
              <p className="mt-2 max-w-[220px] text-[13px] leading-relaxed text-muted-foreground">
                点击「新对话」开始让 AI 帮你整理想法。
              </p>
            </div>
          </div>
        ) : (
          conversations.map((conv) => (
            <motion.div
              key={conv.key}
              className={cn(
                surfaceVariants({ variant: conv.selected ? "selected" : "interactive" }),
                "group flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3.5 py-3",
                !conv.selected && "bg-background/58",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
              )}
              onClick={() => onSelect(conv)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelect(conv);
              }}
              whileHover={{ y: -2 }}
              transition={{ duration: 0.15 }}
              role="button"
              tabIndex={0}
            >
              <div
                className={`relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl ${
                  conv.selected
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                <MessageSquare className="h-4 w-4" />
                {conv.streaming && (
                  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-primary ring-2 ring-background" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-sm font-semibold ${
                    conv.selected ? "text-primary" : "text-foreground"
                  }`}
                >
                  {conv.title}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  {conv.streaming ? (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                      生成中
                    </span>
                  ) : conv.error ? (
                    <span className="truncate text-destructive">生成失败</span>
                  ) : conv.isTemp ? (
                    <span>新对话</span>
                  ) : (
                    <span>{formatDate(conv.created_at)}</span>
                  )}
                </div>
              </div>
              <button
                className="flex-shrink-0 rounded-full p-1.5 text-muted-foreground opacity-100 transition-all hover:bg-destructive/10 hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
                onClick={(e) => onDeleteRequest(conv, e)}
                title="删除对话"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))
        )}
      </div>
    </ScrollArea>
  );
}
