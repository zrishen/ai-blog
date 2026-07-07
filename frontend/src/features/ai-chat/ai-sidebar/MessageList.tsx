import { motion } from "motion/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  Brain,
  Search,
  CheckCircle2,
  BookOpen,
  Link2,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import type { Message } from "../../../stores/chatStore";
import { TrustChoiceGroup } from "../TrustChoiceGroup";
import type { TrustChoiceOption } from "../trustPrompts";
import { collectMessageReferences } from "./messageHelpers";

interface MessageGroup {
  role: Message["role"];
  messages: Message[];
}

interface MessageListProps {
  groups: MessageGroup[];
  streaming: boolean;
  msgsEndRef: React.RefObject<HTMLDivElement | null>;
  historyLoading: boolean;
  historyLoadError: string | null;
  emptyHint: string;
  onReloadHistory: () => void;
  onTrustChoiceSelect: (messageId: number, option: TrustChoiceOption) => void;
}

export function MessageList({
  groups,
  streaming,
  msgsEndRef,
  historyLoading,
  historyLoadError,
  emptyHint,
  onReloadHistory,
  onTrustChoiceSelect,
}: MessageListProps) {
  if (historyLoading) {
    return (
      <ScrollArea className="relative min-h-0 flex-1">
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-5 text-center">
          <div>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-primary/10 text-primary ring-1 ring-primary/15">
              <Sparkles className="h-6 w-6 animate-pulse" />
            </div>
            <p className="text-base font-black tracking-[-0.04em] text-foreground">正在加载历史对话</p>
            <p className="mt-2 max-w-[220px] text-[13px] leading-relaxed text-muted-foreground">
              请稍候，正在读取这段对话的历史消息。
            </p>
          </div>
        </div>
      </ScrollArea>
    );
  }

  if (historyLoadError) {
    return (
      <ScrollArea className="relative min-h-0 flex-1">
        <div className="absolute inset-0 z-10 flex items-center justify-center px-5 text-center">
          <div>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-destructive/10 text-destructive ring-1 ring-destructive/15">
              <AlertCircle className="h-6 w-6" />
            </div>
            <p className="text-base font-black tracking-[-0.04em] text-foreground">历史对话加载失败</p>
            <p className="mt-2 max-w-[240px] text-[13px] leading-relaxed text-muted-foreground">
              {historyLoadError}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 h-8 rounded-full px-4 text-xs"
              onClick={onReloadHistory}
            >
              重新加载
            </Button>
          </div>
        </div>
      </ScrollArea>
    );
  }

  if (groups.length === 0) {
    return (
      <ScrollArea className="relative min-h-0 flex-1">
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-5 text-center">
          <div>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-primary/10 text-primary ring-1 ring-primary/15">
              <Sparkles className="h-6 w-6" />
            </div>
            <p className="text-base font-black tracking-[-0.04em] text-foreground">有什么我可以帮你的？</p>
            <p className="mt-2 max-w-[220px] text-[13px] leading-relaxed text-muted-foreground">
              {emptyHint}
            </p>
          </div>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="relative min-h-0 flex-1">
      <div className="flex w-full flex-col gap-3 px-3 py-4">
        {groups.map((group, groupIndex) => {
          const isAssistantGroup = group.role === "assistant";
          return (
            <motion.div
              key={`${group.role}-${group.messages[0]?.id ?? groupIndex}`}
              className={`flex min-w-0 ${isAssistantGroup ? "justify-start" : "justify-end"}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div
                className={`min-w-0 text-base leading-relaxed ${
                  isAssistantGroup
                    ? "w-full max-w-none rounded-[1.35rem] border border-border/45 bg-muted/70 px-4 py-3 text-left text-foreground shadow-sm"
                    : "max-w-[86%] rounded-[1.35rem] border border-blue-200/55 bg-blue-100/80 px-4 py-2 text-left text-foreground shadow-sm dark:border-blue-400/20 dark:bg-blue-400/15"
                }`}
              >
                {group.messages.map((msg, groupMsgIndex) => {
                  const isLast =
                    groupIndex === groups.length - 1 &&
                    groupMsgIndex === group.messages.length - 1;
                  const isStreaming = isLast && streaming && msg.role === "assistant";
                  const isAssistant = msg.role === "assistant";
                  const msgThinkingMode =
                    msg.thinkingMode ?? (msg.reasoningContent || msg.thinkingContent ? "deep" : "normal");
                  const isDeepMode = msgThinkingMode === "deep";
                  const messageContent = msg.trustChoicePrompt ?? msg.content;
                  const showTrustChoices = isAssistant && !isStreaming && !!msg.trustChoiceOptions?.length;

                  const meaningfulReasoning =
                    isDeepMode && !!msg.reasoningContent && msg.reasoningContent.trim().length > 3;
                  const hasToolEvents = !!(msg.toolEvents && msg.toolEvents.length > 0);
                  const showThinkingPanel = isAssistant && (isDeepMode ? hasToolEvents || !!msg.thinkingContent || meaningfulReasoning : hasToolEvents);
                  const uniqueRefs = collectMessageReferences(msg.toolEvents);

                  return (
                    <div
                      key={msg.id}
                      className={`${isAssistant && groupMsgIndex > 0 ? "mt-3 border-t border-border/60 pt-3" : ""} ${
                        isStreaming && isAssistant ? "border-l-2 border-l-primary pl-3" : ""
                      }`}
                    >
                      <ThinkingPanel
                        isStreaming={!!isStreaming}
                        isDeepMode={isDeepMode}
                        show={!!showThinkingPanel}
                        meaningfulReasoning={!!meaningfulReasoning}
                        reasoningContent={msg.reasoningContent}
                        toolEvents={msg.toolEvents}
                      />
                      <MessageBody
                        messageContent={messageContent}
                        isAssistant={!!isAssistant}
                        isStreaming={!!isStreaming}
                        showThinkingPanel={!!showThinkingPanel}
                        meaningfulReasoning={!!meaningfulReasoning}
                        reasoningContent={msg.reasoningContent}
                        toolEvents={msg.toolEvents}
                      />
                      {isStreaming && isAssistant && (
                        <div className="mt-1 flex items-center gap-1">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:0.2s]" />
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:0.4s]" />
                        </div>
                      )}
                      {showTrustChoices && (
                        <TrustChoiceGroup
                          options={msg.trustChoiceOptions ?? []}
                          disabled={streaming}
                          onSelect={(option) => onTrustChoiceSelect(msg.id, option)}
                        />
                      )}
                      {uniqueRefs.length > 0 && !isStreaming && (
                        <div className="mt-2.5 border-t border-border/40 pt-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                            <span className="font-medium text-muted-foreground/70">引用来源</span>
                            {uniqueRefs.map((ref, ri) => (
                              <span key={ri} className="inline-flex items-center gap-0.5">
                                {ref.type === "rag" ? (
                                  <>
                                    <BookOpen className="h-2.5 w-2.5" />
                                    {ref.source}
                                  </>
                                ) : (
                                  <>
                                    <Link2 className="h-2.5 w-2.5" />
                                    {ref.server}/{ref.tool}
                                  </>
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          );
        })}
        <div className="h-5 flex-shrink-0" aria-hidden="true" />
        <div ref={msgsEndRef} />
      </div>
    </ScrollArea>
  );
}

interface ThinkingPanelProps {
  isStreaming: boolean;
  isDeepMode: boolean;
  show: boolean;
  meaningfulReasoning: boolean;
  reasoningContent?: string;
  toolEvents?: Message["toolEvents"];
}

function ThinkingPanel({
  isStreaming,
  isDeepMode,
  show,
  meaningfulReasoning,
  reasoningContent,
  toolEvents,
}: ThinkingPanelProps) {
  if (!show) return null;

  if (isStreaming) {
    return (
      <div className="mb-2.5 space-y-2 rounded-lg border border-border/40 bg-muted/25 p-2.5 text-[11px] text-muted-foreground">
        {meaningfulReasoning && (
          <div className="rounded-md bg-background/60 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
            <div className="mb-1 flex items-center gap-1 text-primary">
              <Brain className="h-3 w-3 animate-pulse" />
              <span className="font-medium">推理中...</span>
            </div>
            {reasoningContent}
          </div>
        )}
        {toolEvents?.map((evt, ei) => (
          <ToolEventRow key={ei} evt={evt} streamingMode />
        ))}
      </div>
    );
  }

  return (
    <Collapsible defaultOpen={false} className="mb-2.5">
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center gap-1.5 rounded-lg border border-border/60 bg-muted/50 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground">
          <ChevronDown className="h-3 w-3 transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
          {isDeepMode ? <Brain className="h-3 w-3" /> : <Search className="h-3 w-3" />}
          {isDeepMode ? "思考过程" : "工具执行过程"}
          {toolEvents && toolEvents.filter((e) => e.type === "end").length > 0 && (
            <span className="ml-0.5 text-primary">
              ({toolEvents.filter((e) => e.type === "end").length} 步)
            </span>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 space-y-2 rounded-lg border border-border/40 bg-muted/25 p-2.5 text-[11px] text-muted-foreground">
        {meaningfulReasoning && (
          <div className="rounded-md bg-background/60 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
            <div className="mb-1 flex items-center gap-1 text-primary">
              <Brain className="h-3 w-3" />
              <span className="font-medium">推理链</span>
            </div>
            {reasoningContent}
          </div>
        )}
        {toolEvents?.map((evt, ei) => (
          <ToolEventRow key={ei} evt={evt} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface MessageBodyProps {
  messageContent: string;
  isAssistant: boolean;
  isStreaming: boolean;
  showThinkingPanel: boolean;
  meaningfulReasoning: boolean;
  reasoningContent?: string;
  toolEvents?: Message["toolEvents"];
}

function MessageBody({
  messageContent,
  isAssistant,
  isStreaming,
  showThinkingPanel,
  meaningfulReasoning,
  reasoningContent,
  toolEvents,
}: MessageBodyProps) {
  if (messageContent) {
    return (
      <div
        className={`prose max-w-none break-words text-base text-foreground [&_*]:text-foreground prose-p:my-1 prose-p:text-base prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-li:text-base prose-td:text-sm prose-th:text-sm prose-code:rounded-md prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:my-2 prose-pre:rounded-xl prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground prose-blockquote:my-2 prose-blockquote:border-l-primary prose-blockquote:bg-transparent prose-blockquote:py-0.5 prose-blockquote:text-base prose-blockquote:text-foreground dark:prose-invert ${
          isAssistant
            ? "prose-p:leading-7 prose-li:leading-7 prose-strong:font-black"
            : "prose-p:my-0 prose-ul:my-0 prose-ol:my-0"
        }`}
      >
        <Markdown remarkPlugins={[remarkGfm]}>{messageContent}</Markdown>
      </div>
    );
  }

  if (isStreaming && showThinkingPanel) {
    return (
      <div className="space-y-2">
        {meaningfulReasoning && (
          <div className="rounded-md bg-background/60 p-2.5 text-[12px] leading-relaxed whitespace-pre-wrap text-foreground/80">
            <div className="mb-1.5 flex items-center gap-1.5 text-primary">
              <Brain className="h-3.5 w-3.5 animate-pulse" />
              <span className="font-medium">推理中...</span>
            </div>
            {reasoningContent}
          </div>
        )}
        {toolEvents?.map((evt, ei) => (
          <div key={ei} className="flex items-start gap-1.5 text-[12px]">
            {evt.type === "start" ? (
              <Search className="mt-0.5 h-3 w-3 flex-shrink-0 animate-pulse text-muted-foreground/70" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary/70" />
            )}
            <span className={evt.type === "start" ? "text-muted-foreground" : "text-foreground"}>
              {evt.toolName}
              {evt.type === "start" ? "..." : ""}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

interface ToolEventRowProps {
  evt: NonNullable<Message["toolEvents"]>[number];
  streamingMode?: boolean;
}

function ToolEventRow({ evt, streamingMode }: ToolEventRowProps) {
  return (
    <div className="flex items-start gap-1.5">
      {evt.type === "start" ? (
        <Search className="mt-0.5 h-3 w-3 flex-shrink-0 animate-pulse text-muted-foreground/70" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary/70" />
      )}
      <div className="min-w-0 flex-1">
        <span className={evt.type === "start" ? "text-muted-foreground" : "text-foreground"}>
          {evt.toolName}
          {evt.type === "start" && streamingMode ? "..." : ""}
        </span>
        {evt.type === "end" && evt.result && (
          <div className="mt-0.5 truncate pl-2 text-[10px] text-muted-foreground/80">
            {evt.result.replace(/\n/g, " ").slice(0, 120)}
          </div>
        )}
        {evt.type === "end" &&
          evt.references?.map((ref, ri) => (
            <div key={ri} className="mt-0.5 flex items-center gap-1 pl-2 text-[10px]">
              {ref.type === "rag" ? (
                <>
                  <BookOpen className="h-2.5 w-2.5" />
                  <span>
                    {ref.source}
                    {ref.collection ? ` · ${ref.collection}` : ""}
                    {ref.distance != null ? ` · 距离: ${ref.distance.toFixed(2)}` : ""}
                  </span>
                </>
              ) : (
                <>
                  <Link2 className="h-2.5 w-2.5" />
                  <span>
                    {ref.server}/{ref.tool}
                  </span>
                </>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
