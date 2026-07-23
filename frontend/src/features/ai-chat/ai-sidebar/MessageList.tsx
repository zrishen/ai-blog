import { memo, useEffect, useRef, useState } from "react";
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
import { maskStreamingMarkdown } from "./streamingMarkdown";
import { MessageAttachments } from "./MessageAttachments";

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
      <div className="flex w-full flex-col gap-3 px-3 pb-4 pt-14">
        {groups.map((group, groupIndex) => {
          const isAssistantGroup = group.role === "assistant";
          return (
            <motion.div
              key={`${group.role}-${group.messages[0]?.created_at ?? groupIndex}`}
              className={`flex min-w-0 ${isAssistantGroup ? "justify-start" : "justify-end"}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div
                className={`min-w-0 ${isAssistantGroup
                  ? "w-full max-w-none text-left text-base leading-relaxed text-foreground"
                  : "flex max-w-[86%] flex-col items-end gap-2"
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

                  const streamMessage = msg as Message & {
                    streamingRound?: string;
                    streamFinalized?: boolean;
                    streamError?: string;
                  };
                  const meaningfulReasoning = !!msg.reasoningContent && msg.reasoningContent.trim().length > 3;
                  const meaningfulThinkingContent = !!msg.thinkingContent && msg.thinkingContent.trim().length > 3;
                  const hasToolEvents = !!(msg.toolEvents && msg.toolEvents.length > 0);
                  const hasLoopSteps = !!(msg.loopSteps && msg.loopSteps.length > 0);
                  const hasThinkingDuration = msg.thinkingDurationMs !== undefined;
                  const hasStreamingRound = !!streamMessage.streamingRound?.trim();
                  const hasStreamError = !!streamMessage.streamError?.trim();
                  const streamActive = isStreaming && !streamMessage.streamFinalized;
                  const showThinkingPanel = isAssistant && (streamActive || hasThinkingDuration || hasToolEvents || hasLoopSteps || meaningfulThinkingContent || meaningfulReasoning || hasStreamingRound || hasStreamError);
                  const showThinkingPlaceholder = streamActive
                    && !hasStreamingRound
                    && !messageContent
                    && !meaningfulReasoning
                    && !meaningfulThinkingContent
                    && !hasToolEvents
                    && !hasLoopSteps
                    && !hasStreamError;
                  const startedAt = Date.parse(msg.created_at);
                  const streamingDurationMs = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : undefined;
                  const uniqueRefs = collectMessageReferences(msg.toolEvents);

                  return (
                    <div
                      key={`msg-${groupIndex}-${groupMsgIndex}-${msg.role}`}
                      className={isAssistant
                        ? (groupMsgIndex > 0 ? "mt-3 border-t border-border/60 pt-3" : "")
                        : "flex w-full flex-col items-end"}
                    >
                      {showThinkingPlaceholder && <ThinkingPlaceholder />}
                      <ThinkingPanel
                        isStreaming={streamActive}
                        isFinalized={!!streamMessage.streamFinalized || !isStreaming}
                        show={!!showThinkingPanel}
                        meaningfulReasoning={!!meaningfulReasoning}
                        meaningfulThinkingContent={!!meaningfulThinkingContent}
                        reasoningContent={msg.reasoningContent}
                        thinkingContent={msg.thinkingContent}
                        loopSteps={msg.loopSteps}
                        toolEvents={msg.toolEvents}
                        streamingRound={streamMessage.streamingRound}
                        streamError={streamMessage.streamError}
                        durationMs={streamActive ? streamingDurationMs : msg.thinkingDurationMs}
                      />
                      {isAssistant ? (
                        <>
                          <MessageAttachments attachments={msg.attachments} />
                          <MessageBody
                            messageContent={messageContent}
                            isAssistant
                          />
                        </>
                      ) : (
                        <>
                          <MessageAttachments attachments={msg.attachments} />
                          {messageContent ? (
                            <div className="rounded-[1.35rem] border border-border/45 bg-muted/70 px-4 py-2 text-left text-base leading-relaxed text-foreground shadow-sm">
                              <MessageBody
                                messageContent={messageContent}
                                isAssistant={false}
                              />
                            </div>
                          ) : null}
                        </>
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
          variant="secondary"
          className="absolute bottom-3 left-1/2 z-20 h-7 w-7 -translate-x-1/2 rounded-full border border-border/50 bg-muted/70 p-0 text-muted-foreground shadow-sm backdrop-blur hover:bg-muted [&>svg]:size-3"
          onClick={onJumpToLatest}
        >
          <ArrowDown />
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
  isFinalized: boolean;
  show: boolean;
  meaningfulReasoning: boolean;
  meaningfulThinkingContent: boolean;
  reasoningContent?: string;
  thinkingContent?: string;
  loopSteps?: string[];
  toolEvents?: Message["toolEvents"];
  streamingRound?: string;
  streamError?: string;
  durationMs?: number;
}

function ThinkingPanel({
  isStreaming,
  isFinalized,
  show,
  meaningfulReasoning,
  meaningfulThinkingContent,
  reasoningContent,
  thinkingContent,
  loopSteps,
  toolEvents,
  streamingRound,
  streamError,
  durationMs,
}: ThinkingPanelProps) {
  const [open, setOpen] = useState(false);
  const userToggledRef = useRef(false);

  const handleOpenChange = (next: boolean) => {
    userToggledRef.current = true;
    setOpen(next);
  };

  useEffect(() => {
    if (isFinalized && !userToggledRef.current) {
      setOpen(false);
    }
  }, [isFinalized]);

  if (!show) return null;

  const durationText = durationMs === undefined ? "" : formatThinkingDuration(durationMs);
  const processContent = meaningfulThinkingContent ? thinkingContent : "";
  const entries = buildThinkingEntries({
    reasoningContent: meaningfulReasoning ? reasoningContent : undefined,
    loopSteps,
    toolEvents,
    fallbackProcessContent: processContent,
    streamingRound,
    streamError,
  });
  const hasEntries = entries.length > 0;

  if (isStreaming && !isFinalized) {
    if (!hasEntries) return null;
    return (
      <div className="mb-2.5" data-testid="thinking-panel" data-streaming="true">
        <div data-testid="thinking-process" className="-ml-1.5 grid grid-rows-[1fr] opacity-100">
          <ThinkingFlow entries={entries} />
        </div>
      </div>
    );
  }

  if (!hasEntries) return null;

  const stepCount = countThinkingSteps(entries);
  const summaryParts = [
    stepCount > 0 ? `${stepCount} 步` : "",
    durationText ? `耗时 ${durationText}` : "",
  ].filter(Boolean);
  const title = `思考过程${summaryParts.length > 0 ? `（${summaryParts.join("，")}）` : ""}`;

  return (
    <Collapsible
      open={open}
      onOpenChange={handleOpenChange}
      className="mb-2.5"
      data-testid="thinking-panel"
      data-streaming="false"
    >
      <CollapsibleTrigger asChild>
        <button className="flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 text-base font-medium text-muted-foreground transition-colors hover:bg-muted/65 hover:text-foreground">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none [[data-state=open]>&]:rotate-90" aria-hidden="true" />
          <span>{title}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent forceMount asChild>
        <div
          className={`grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out motion-reduce:transition-none ${open
            ? "mt-1.5 grid-rows-[1fr] opacity-100"
            : "mt-0 grid-rows-[0fr] opacity-0"
          }`}
          data-testid="thinking-process"
          aria-hidden={!open}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="-ml-1.5">
              <ThinkingFlow entries={entries} />
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

type ToolPair = {
  start?: NonNullable<Message["toolEvents"]>[number];
  end?: NonNullable<Message["toolEvents"]>[number];
};

type ThinkingEntry =
  | { type: "reasoning"; key: string; content: string }
  | { type: "process"; key: string; content: string }
  | { type: "action"; key: string; tools: ToolPair[] }
  | { type: "error"; key: string; content: string };

function buildThinkingEntries({
  reasoningContent,
  loopSteps,
  toolEvents,
  fallbackProcessContent,
  streamingRound,
  streamError,
}: {
  reasoningContent?: string;
  loopSteps?: string[];
  toolEvents?: Message["toolEvents"];
  fallbackProcessContent?: string;
  streamingRound?: string;
  streamError?: string;
}): ThinkingEntry[] {
  const entries: ThinkingEntry[] = [];
  const reasoning = normalizeThinkingText(reasoningContent);
  if (reasoning && reasoning.length > 3) entries.push({ type: "reasoning", key: "reasoning", content: reasoning });

  const processes = (loopSteps && loopSteps.length > 0 ? loopSteps : fallbackProcessContent ? [fallbackProcessContent] : [])
    .map(normalizeThinkingText)
    .filter((step) => step.length > 3);
  const toolPairs = buildToolPairs(toolEvents);
  const toolGroups = groupToolPairsForProcesses(toolPairs, processes.length);
  const maxLen = Math.max(processes.length, toolGroups.length);

  const temporaryRound = normalizeThinkingText(streamingRound);
  let streamingRoundPlaced = false;
  for (let i = 0; i < maxLen; i += 1) {
    if (processes[i]) {
      entries.push({ type: "process", key: `round-${i}`, content: processes[i] });
    } else if (temporaryRound && i === processes.length && !streamingRoundPlaced) {
      // 当前正在流式的轮正文补位到已完成轮之后，使其后轮的工具节点排在正文之后（与完成后顺序一致）
      entries.push({ type: "process", key: "streaming-round-live", content: temporaryRound });
      streamingRoundPlaced = true;
    }
    if (toolGroups[i]?.length) entries.push({ type: "action", key: `tools-${i}`, tools: toolGroups[i] });
  }

  if (temporaryRound && !streamingRoundPlaced && !processes.includes(temporaryRound)) {
    entries.push({ type: "process", key: "streaming-round-live", content: temporaryRound });
  }
  const error = normalizeThinkingText(streamError);
  if (error) entries.push({ type: "error", key: "stream-error", content: error });

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
  if (!toolEvents) return toolPairs;

  const pairByCallId = new Map<string, ToolPair>();
  for (const evt of toolEvents) {
    if (evt.callId) {
      let pair = pairByCallId.get(evt.callId);
      if (!pair) {
        pair = {};
        pairByCallId.set(evt.callId, pair);
        toolPairs.push(pair);
      }
      if (evt.type === "start") pair.start = evt;
      else pair.end = evt;
    } else if (evt.type === "start") {
      toolPairs.push({ start: evt });
    } else {
      const last = toolPairs[toolPairs.length - 1];
      if (last && !last.end && (!last.start || !last.start.callId)) {
        last.end = evt;
      } else {
        toolPairs.push({ end: evt });
      }
    }
  }
  return toolPairs;
}

function groupToolPairsForProcesses(toolPairs: ToolPair[], processCount: number): ToolPair[][] {
  if (toolPairs.length === 0) return [];

  // 优先按工具自身的 roundId 分组：流式过程中 processCount（已完成的轮数）滞后于
  // 工具事件，只有用 roundId 才能把跨轮工具（如 create→write）正确拆到各自轮，
  // 避免流式时合并成「N 条命令」、完成后才拆开的不一致。
  const pairRoundId = (pair: ToolPair) => pair.start?.roundId ?? pair.end?.roundId;
  if (toolPairs.some((pair) => pairRoundId(pair) !== undefined)) {
    const groupMap = new Map<number, ToolPair[]>();
    for (const pair of toolPairs) {
      const idx = pairRoundId(pair) ?? 0;
      if (!groupMap.has(idx)) groupMap.set(idx, []);
      groupMap.get(idx)!.push(pair);
    }
    return Array.from(groupMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([, group]) => group);
  }

  const hasLoopStepIndex = toolPairs.some((pair) =>
    pair.start?.loopStepIndex !== undefined || pair.end?.loopStepIndex !== undefined);

  if (hasLoopStepIndex) {
    const groupMap = new Map<number, ToolPair[]>();
    for (const pair of toolPairs) {
      const idx = pair.start?.loopStepIndex ?? pair.end?.loopStepIndex ?? 0;
      if (!groupMap.has(idx)) groupMap.set(idx, []);
      groupMap.get(idx)!.push(pair);
    }
    return Array.from(groupMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([, group]) => group);
  }

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
      {entries.map((entry) => (
        <TimelineNode key={entry.key}>
          {entry.type === "reasoning" && <CollapsibleReasoningBlock content={entry.content} />}
          {entry.type === "process" && <ProcessText content={entry.content} />}
          {entry.type === "action" && <ActionNode tools={entry.tools} />}
          {entry.type === "error" && <div className="px-1.5 text-base leading-relaxed text-destructive">{entry.content}</div>}
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
  const masked = maskStreamingMarkdown(content);
  if (!masked) return null;
  return (
    <div className="prose max-w-none break-words px-1.5 text-base leading-relaxed text-foreground [&_*]:text-foreground prose-p:my-0.5 prose-p:text-base prose-ul:my-0.5 prose-ol:my-0.5 prose-li:my-0 prose-li:text-base prose-td:text-sm prose-th:text-sm prose-code:rounded-md prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:my-1 prose-pre:rounded-xl prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground prose-blockquote:my-1 prose-blockquote:border-l-primary prose-blockquote:bg-transparent prose-blockquote:py-0.5 prose-blockquote:text-base prose-blockquote:text-foreground dark:prose-invert">
      <Markdown remarkPlugins={[remarkGfm]}>{masked}</Markdown>
    </div>
  );
}

function ActionNode({ tools }: { tools: ToolPair[] }) {
  const completeCount = tools.filter((tool) => tool.end).length;
  const allComplete = completeCount === tools.length;
  const preparingCount = tools.filter((t) => !t.end && t.start?.status === "preparing").length;
  const title = tools.length === 1
    ? (tools[0].start?.status === "preparing" && !tools[0].end
      ? toolPrepLabel(formatToolName(tools[0]))
      : `${allComplete ? "已运行" : "正在运行"} ${formatToolName(tools[0])}`)
    : preparingCount > 0
      ? `正在生成 ${tools.length} 条命令…`
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

function toolPrepLabel(toolName: string): string {
  if (toolName === "blog_write_post") return "正在生成文章";
  if (toolName === "blog_create_post") return "正在创建草稿";
  if (toolName === "blog_edit_post") return "正在生成修改";
  if (toolName.startsWith("blog_")) return "正在生成文章";
  if (toolName.startsWith("file_") || toolName.includes("search")) return "正在检索文件";
  if (toolName.startsWith("research_")) return "正在研究";
  return `正在准备 ${toolName}`;
}

function ToolDetail({ tool }: { tool: ToolPair }) {
  const evt = tool.end || tool.start;
  if (!evt) return null;
  const result = tool.end?.result?.replace(/\n/g, " ").trim();
  const references = tool.end?.references ?? [];

  return (
    <div className="text-base leading-relaxed text-muted-foreground/75">
      <div className="font-medium text-muted-foreground">{formatToolName(tool)}</div>
      {!tool.end && <div className="mt-0.5 text-muted-foreground/80">{tool.start?.status === "preparing" ? "正在生成…" : "正在运行..."}</div>}
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

function ThinkingPlaceholder() {
  return (
    <div
      className="flex items-center gap-2 py-1 motion-reduce:items-center"
      data-testid="thinking-placeholder"
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary animate-pulse motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span className="thinking-flow-text text-base font-medium leading-7">
        正在思考...
      </span>
    </div>
  );
}
