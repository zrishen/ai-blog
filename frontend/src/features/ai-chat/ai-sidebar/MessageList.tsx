import { memo, useEffect, useState } from "react";
import { motion } from "motion/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronRight,
  BookOpen,
  Link2,
  Sparkles,
  AlertCircle,
  ArrowDown,
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
  viewportRef?: React.Ref<HTMLDivElement>;
  showJumpButton?: boolean;
  historyLoading: boolean;
  historyLoadError: string | null;
  emptyHint: string;
  onReloadHistory: () => void;
  onJumpToLatest?: () => void;
  onTrustChoiceSelect: (messageId: number, option: TrustChoiceOption) => void;
}

function formatThinkingDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 1) return "< 1 秒";
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
}

function MessageListComponent({
  groups,
  streaming,
  msgsEndRef,
  viewportRef,
  showJumpButton,
  historyLoading,
  historyLoadError,
  emptyHint,
  onReloadHistory,
  onJumpToLatest,
  onTrustChoiceSelect,
}: MessageListProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);

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
    <ScrollArea className="relative min-h-0 flex-1" viewportRef={viewportRef}>
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
                className={`min-w-0 text-base leading-relaxed ${isAssistantGroup
                  ? "w-full max-w-none text-left text-foreground"
                  : "max-w-[86%] rounded-[1.35rem] border border-border/45 bg-muted/70 px-4 py-2 text-left text-foreground shadow-sm"
                  }`}
              >
                {group.messages.map((msg, groupMsgIndex) => {
                  const isLast =
                    groupIndex === groups.length - 1 &&
                    groupMsgIndex === group.messages.length - 1;
                  const isStreaming = isLast && streaming && msg.role === "assistant";
                  const isAssistant = msg.role === "assistant";
                  const messageContent = msg.trustChoicePrompt ?? msg.content;
                  const showTrustChoices = isAssistant && !isStreaming && !!msg.trustChoiceOptions?.length;

                  const meaningfulReasoning = !!msg.reasoningContent && msg.reasoningContent.trim().length > 3;
                  const meaningfulThinkingContent = !!msg.thinkingContent && msg.thinkingContent.trim().length > 3;
                  const hasToolEvents = !!(msg.toolEvents && msg.toolEvents.length > 0);
                  const hasLoopSteps = !!(msg.loopSteps && msg.loopSteps.length > 0);
                  const hasThinkingDuration = msg.thinkingDurationMs !== undefined;
                  const showThinkingPanel = isAssistant && (isStreaming || hasThinkingDuration || hasToolEvents || hasLoopSteps || meaningfulThinkingContent || meaningfulReasoning);
                  const startedAt = Date.parse(msg.created_at);
                  const streamingDurationMs = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : undefined;
                  const uniqueRefs = collectMessageReferences(msg.toolEvents);

                  return (
                    <div
                      key={msg.id}
                      className={isAssistant && groupMsgIndex > 0 ? "mt-3 border-t border-border/60 pt-3" : ""}
                    >
                      <ThinkingPanel
                        isStreaming={!!isStreaming}
                        show={!!showThinkingPanel}
                        meaningfulReasoning={!!meaningfulReasoning}
                        meaningfulThinkingContent={!!meaningfulThinkingContent}
                        reasoningContent={msg.reasoningContent}
                        thinkingContent={msg.thinkingContent}
                        loopSteps={msg.loopSteps}
                        toolEvents={msg.toolEvents}
                        durationMs={isStreaming ? streamingDurationMs : msg.thinkingDurationMs}
                      />
                      <MessageBody
                        messageContent={messageContent}
                        isAssistant={!!isAssistant}
                      />
                      {showTrustChoices && (
                        <TrustChoiceGroup
                          options={msg.trustChoiceOptions ?? []}
                          disabled={streaming}
                          onSelect={(option) => onTrustChoiceSelect(msg.id, option)}
                        />
                      )}
                      {uniqueRefs.length > 0 && !isStreaming && (
                        <div className="mt-2.5 border-t border-border/40 pt-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-muted-foreground">
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
      {showJumpButton && onJumpToLatest && (
        <Button
          type="button"
          size="icon"
          className="absolute bottom-4 left-1/2 z-20 h-9 w-9 -translate-x-1/2 rounded-full shadow-lg shadow-primary/20"
          onClick={onJumpToLatest}
          title="跳到最新回复"
          aria-label="跳到最新回复"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
      )}
    </ScrollArea>
  );
}

export const MessageList = memo(MessageListComponent, (prev, next) =>
  prev.groups === next.groups &&
  prev.streaming === next.streaming &&
  prev.showJumpButton === next.showJumpButton &&
  prev.historyLoading === next.historyLoading &&
  prev.historyLoadError === next.historyLoadError &&
  prev.emptyHint === next.emptyHint
);

interface ThinkingPanelProps {
  isStreaming: boolean;
  show: boolean;
  meaningfulReasoning: boolean;
  meaningfulThinkingContent: boolean;
  reasoningContent?: string;
  thinkingContent?: string;
  loopSteps?: string[];
  toolEvents?: Message["toolEvents"];
  durationMs?: number;
}

function ThinkingPanel({
  isStreaming,
  show,
  meaningfulReasoning,
  meaningfulThinkingContent,
  reasoningContent,
  thinkingContent,
  loopSteps,
  toolEvents,
  durationMs,
}: ThinkingPanelProps) {
  if (!show) return null;

  const durationText = durationMs === undefined ? "" : formatThinkingDuration(durationMs);
  const processContent = meaningfulThinkingContent ? thinkingContent : "";
  const entries = buildThinkingEntries({
    reasoningContent: meaningfulReasoning ? reasoningContent : undefined,
    loopSteps,
    toolEvents,
    fallbackProcessContent: processContent,
  });
  const hasEntries = entries.length > 0;
  const stepCount = countThinkingSteps(entries);
  const summaryParts = [
    stepCount > 0 ? `${stepCount} 步` : "",
    durationText ? `耗时 ${durationText}` : "",
  ].filter(Boolean);

  // 流式阶段：过程内容直接显示在对话里，完成后再收进“思考过程”。
  if (isStreaming) {
    return (
      <div className="mb-2.5 text-base text-muted-foreground">
        {hasEntries ? (
          <ThinkingFlow entries={entries} />
        ) : (
          <div className="text-base leading-relaxed">正在生成回复</div>
        )}
      </div>
    );
  }

  if (!hasEntries) return null;

  // 完成阶段：过程流整体折叠，最终回答保持在外部。
  return (
    <Collapsible defaultOpen={false} className="mb-2.5">
      <CollapsibleTrigger asChild>
        <button className="flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 text-base font-medium text-muted-foreground transition-colors hover:bg-muted/65 hover:text-foreground">
          <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 [[data-state=open]>&]:rotate-90" aria-hidden="true" />
          <span>思考过程{summaryParts.length > 0 ? `（${summaryParts.join("，")}）` : ""}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 -ml-1.5">
        <ThinkingFlow entries={entries} />
      </CollapsibleContent>
    </Collapsible>
  );
}

type ToolPair = {
  start?: NonNullable<Message["toolEvents"]>[number];
  end?: NonNullable<Message["toolEvents"]>[number];
};

type ThinkingEntry =
  | { type: "reasoning"; content: string }
  | { type: "process"; content: string }
  | { type: "action"; tools: ToolPair[] };

function buildThinkingEntries({
  reasoningContent,
  loopSteps,
  toolEvents,
  fallbackProcessContent,
}: {
  reasoningContent?: string;
  loopSteps?: string[];
  toolEvents?: Message["toolEvents"];
  fallbackProcessContent?: string;
}): ThinkingEntry[] {
  const entries: ThinkingEntry[] = [];
  const reasoning = normalizeThinkingText(reasoningContent);
  if (reasoning && reasoning.length > 3) entries.push({ type: "reasoning", content: reasoning });

  const processes = (loopSteps && loopSteps.length > 0 ? loopSteps : fallbackProcessContent ? [fallbackProcessContent] : [])
    .map(normalizeThinkingText)
    .filter((step) => step.length > 3);
  const toolPairs = buildToolPairs(toolEvents);
  const toolGroups = groupToolPairsForProcesses(toolPairs, processes.length);
  const maxLen = Math.max(processes.length, toolGroups.length);

  for (let i = 0; i < maxLen; i += 1) {
    if (processes[i]) entries.push({ type: "process", content: processes[i] });
    if (toolGroups[i]?.length) entries.push({ type: "action", tools: toolGroups[i] });
  }

  return entries;
}

function normalizeThinkingText(text?: string) {
  return (text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .trim();
}

function buildToolPairs(toolEvents?: Message["toolEvents"]): ToolPair[] {
  const toolPairs: ToolPair[] = [];
  if (toolEvents) {
    for (const evt of toolEvents) {
      if (evt.type === "start") {
        toolPairs.push({ start: evt });
      } else if (evt.type === "end") {
        const last = toolPairs[toolPairs.length - 1];
        if (last && !last.end) {
          last.end = evt;
        } else {
          toolPairs.push({ end: evt });
        }
      }
    }
  }
  return toolPairs;
}

function groupToolPairsForProcesses(toolPairs: ToolPair[], processCount: number): ToolPair[][] {
  if (toolPairs.length === 0) return [];
  if (processCount <= 1) return [toolPairs];
  const groups: ToolPair[][] = Array.from({ length: processCount }, () => []);
  toolPairs.forEach((pair, index) => {
    groups[Math.min(index, processCount - 1)].push(pair);
  });
  return groups.filter((group) => group.length > 0);
}

function countThinkingSteps(entries: ThinkingEntry[]) {
  const actionCount = entries.filter((entry) => entry.type === "action").length;
  const processCount = entries.filter((entry) => entry.type === "process").length;
  return Math.max(actionCount, processCount);
}

function ThinkingFlow({ entries }: { entries: ThinkingEntry[] }) {
  return (
    <div className="space-y-1.2 text-base text-muted-foreground">
      {entries.map((entry, index) => (
        <TimelineNode key={`${entry.type}-${index}`}>
          {entry.type === "reasoning" && <CollapsibleReasoningBlock content={entry.content} />}
          {entry.type === "process" && <ProcessText content={entry.content} />}
          {entry.type === "action" && <ActionNode tools={entry.tools} />}
        </TimelineNode>
      ))}
    </div>
  );
}

/** 第一行：模型内部推理内容，保持折叠。 */
function CollapsibleReasoningBlock({ content }: { content: string }) {
  const charCount = content.length;
  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger asChild>
        <button className="flex w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-base text-muted-foreground transition-colors hover:bg-muted/65 hover:text-foreground">
          <span className="font-medium">模型推理</span>
          <span className="text-muted-foreground/60">({charCount} 字)</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1">
        <div className="whitespace-pre-wrap px-5 break-words text-base leading-relaxed text-muted-foreground">
          {content}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ProcessText({ content }: { content: string }) {
  return (
    <div className="whitespace-pre-wrap break-words px-1.5 text-base leading-relaxed text-foreground">
      {content}
    </div>
  );
}

function ActionNode({ tools }: { tools: ToolPair[] }) {
  const completeCount = tools.filter((tool) => tool.end).length;
  const allComplete = completeCount === tools.length;
  const title = tools.length === 1
    ? `${allComplete ? "已运行" : "正在运行"} ${formatToolName(tools[0])}`
    : allComplete
      ? `已运行 ${tools.length} 条命令`
      : `正在运行 ${tools.length} 条命令`;

  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger asChild>
        <button className="flex w-full cursor-pointer items-center rounded-md px-1.5 py-1 text-left text-base text-muted-foreground/70 transition-colors hover:bg-muted/65 hover:text-muted-foreground">
          {title}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-1.5 pl-3">
        {tools.map((tool, index) => (
          <ToolDetail key={`${formatToolName(tool)}-${index}`} tool={tool} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** 时间线单个节点 */
function TimelineNode({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15 }}
      className="pb-1"
    >
      <div className="min-w-0">{children}</div>
    </motion.div>
  );
}

function formatToolName(tool: ToolPair) {
  return tool.end?.toolName || tool.start?.toolName || "操作";
}

function ToolDetail({ tool }: { tool: ToolPair }) {
  const evt = tool.end || tool.start;
  if (!evt) return null;
  const result = tool.end?.result?.replace(/\n/g, " ").trim();
  const references = tool.end?.references ?? [];

  return (
    <div className="text-base leading-relaxed text-muted-foreground/75">
      <div className="font-medium text-muted-foreground">{formatToolName(tool)}</div>
      {!tool.end && <div className="mt-0.5 text-muted-foreground/80">正在运行...</div>}
      {result && (
        <div className="mt-0.5 break-words text-muted-foreground/80">
          {result.slice(0, 220)}
          {result.length > 220 ? "..." : ""}
        </div>
      )}
      {references.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {references.map((ref, ri) => (
            <div key={ri} className="flex items-center gap-1 text-base text-muted-foreground/80">
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
      )}
    </div>
  );
}

interface MessageBodyProps {
  messageContent: string;
  isAssistant: boolean;
}

function MessageBody({
  messageContent,
  isAssistant,
}: MessageBodyProps) {
  if (messageContent) {
    return (
      <div
        className={`prose max-w-none break-words text-base text-foreground [&_*]:text-foreground prose-p:my-1 prose-p:text-base prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-li:text-base prose-td:text-sm prose-th:text-sm prose-code:rounded-md prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:my-2 prose-pre:rounded-xl prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground prose-blockquote:my-2 prose-blockquote:border-l-primary prose-blockquote:bg-transparent prose-blockquote:py-0.5 prose-blockquote:text-base prose-blockquote:text-foreground dark:prose-invert ${isAssistant
          ? "prose-p:leading-7 prose-li:leading-7 prose-strong:font-black"
          : "prose-p:my-0 prose-ul:my-0 prose-ol:my-0"
          }`}
      >
        <Markdown remarkPlugins={[remarkGfm]}>{messageContent}</Markdown>
      </div>
    );
  }

  return null;
}
