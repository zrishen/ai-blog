import { motion, AnimatePresence } from "motion/react";
import {
  ChevronRight,
  Sparkles,
  MessageSquare,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Conversation } from "../../../stores/chatStore";
import { useChat } from "../../../stores/chatStore";
import { formatDate } from "./messageHelpers";

interface ConversationListViewProps {
  conversations: Conversation[];
  error: string | null;
  onSelect: (conv: Conversation) => void;
  onDeleteRequest: (convId: number, e: React.MouseEvent) => void;
  onDismissError: () => void;
}

export function ConversationListView({
  conversations,
  error,
  onSelect,
  onDeleteRequest,
  onDismissError,
}: ConversationListViewProps) {
  const { state } = useChat();

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
          <div className="flex min-h-[220px] items-center justify-center rounded-3xl border border-dashed border-border bg-background/55 p-5 text-center">
            <div>
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <p className="text-[15px] font-bold text-foreground">还没有对话</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                点击「新对话」开始让 AI 帮你整理想法。
              </p>
            </div>
          </div>
        ) : (
          conversations.map((conv) => {
            const selected = conv.id === state.aiSidebarConversationId;
            return (
              <motion.div
                key={conv.id}
                className={`group flex w-full cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-3 transition-all duration-150 ${
                  selected
                    ? "border-primary/25 bg-primary/10 shadow-md shadow-primary/8"
                    : "border-border/60 bg-background/58 hover:border-primary/18 hover:bg-accent/70"
                }`}
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
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl ${
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate text-sm font-semibold ${
                      selected ? "text-primary" : "text-foreground"
                    }`}
                  >
                    {conv.title}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {formatDate(conv.created_at)}
                  </div>
                </div>
                <button
                  className="flex-shrink-0 rounded-full p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  onClick={(e) => onDeleteRequest(conv.id, e)}
                  title="删除对话"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            );
          })
        )}
      </div>
    </ScrollArea>
  );
}
