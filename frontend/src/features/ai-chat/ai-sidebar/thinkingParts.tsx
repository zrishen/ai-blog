import { motion } from "motion/react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, Link2, AlertCircle } from "lucide-react";

import { maskStreamingMarkdown } from "./streamingMarkdown";

import type { ThinkingEntry, ToolPair } from "./thinkingFlow";

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { MermaidBlock } from "@/components/MermaidBlock";
import { extractCodeLanguage, extractCodeText } from "@/utils/mermaidCode";



export function ThinkingFlow({ entries }: { entries: ThinkingEntry[] }) {
  return (
    <div className="space-y-1.2 text-reading text-muted-foreground">
      {entries.map((entry) => (
        <TimelineNode key={entry.key}>
          {entry.type === "reasoning" && <CollapsibleReasoningBlock content={entry.content} />}
          {entry.type === "process" && <ProcessText content={entry.content} />}
          {entry.type === "action" && <ActionNode tools={entry.tools} />}
        </TimelineNode>
      ))}
    </div>
  );
}

function CollapsibleReasoningBlock({ content }: { content: string }) {
  const charCount = content.length;
  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger asChild>
        <button className="flex w-full cursor-pointer items-center gap-1 rounded-control px-1.5 py-1 text-reading text-muted-foreground transition-colors hover:bg-muted/65 hover:text-foreground">
          <span className="font-medium">模型推理</span>
          <span className="text-muted-foreground/60">({charCount} 字)</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1">
        <div className="whitespace-pre-wrap px-5 break-words text-reading leading-relaxed text-muted-foreground">
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
    <div className="prose max-w-none break-words px-1.5 text-reading leading-relaxed text-foreground [&_*]:text-foreground prose-p:my-0.5 prose-p:text-reading prose-ul:my-0.5 prose-ol:my-0.5 prose-li:my-0 prose-li:text-reading prose-td:text-body prose-th:text-body prose-code:rounded-control prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:my-1 prose-pre:rounded-xl prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground prose-blockquote:my-1 prose-blockquote:border-l-primary prose-blockquote:bg-transparent prose-blockquote:py-0.5 prose-blockquote:text-reading prose-blockquote:text-foreground dark:prose-invert">
      <Markdown remarkPlugins={[remarkGfm]} components={messageMermaidComponents}>{masked}</Markdown>
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
        <button className="flex w-full cursor-pointer items-center rounded-control px-1.5 py-1 text-left text-reading text-muted-foreground/70 transition-colors hover:bg-muted/65 hover:text-muted-foreground">
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
  return `正在准备 ${toolName}`;
}

function ToolDetail({ tool }: { tool: ToolPair }) {
  const evt = tool.end || tool.start;
  if (!evt) return null;
  const result = tool.end?.result?.replace(/\n/g, " ").trim();
  const references = tool.end?.references ?? [];

  return (
    <div className="text-reading leading-relaxed text-muted-foreground/75">
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
            <div key={ri} className="flex items-center gap-1 text-reading text-muted-foreground/80">
              {ref.type === "rag" ? (
                <>
                  <BookOpen className="h-2.5 w-2.5" />
                  <span>
                    {ref.source}
                    {ref.collection ? ` · ${ref.collection}` : ""}
                    {ref.distance != null ? ` · 距离: ${ref.distance.toFixed(2)}` : ""}
                  </span>
                </>
              ) : ref.type === "memory" ? (
                <>
                  <BookOpen className="h-2.5 w-2.5" />
                  <span>
                    {ref.source}
                    {ref.kind ? ` · ${ref.kind}` : ""}
                    {ref.status ? ` · ${ref.status}` : ""}
                    {ref.time ? ` · ${ref.time}` : ""}
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

const messageMermaidComponents: Components = {
  pre: ({ children }) => {
    if (extractCodeLanguage(children) === "mermaid") {
      return <MermaidBlock code={extractCodeText(children)} />;
    }
    return <pre>{children}</pre>;
  },
};

export function StreamErrorBanner({ message }: { message: string }) {
  return (
    <div
      data-testid="stream-error-banner"
      className="mb-2 flex items-start gap-2 rounded-panel border border-destructive/30 bg-destructive/5 px-3 py-2 text-reading leading-relaxed text-destructive"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

export function MessageBody({
  messageContent,
  isAssistant,
}: {
  messageContent: string;
  isAssistant: boolean;
}) {
  if (messageContent) {
    return (
      <div
        className={`prose max-w-none break-words text-reading text-foreground [&_*]:text-foreground prose-p:my-1 prose-p:text-reading prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-li:text-reading prose-td:text-body prose-th:text-body prose-code:rounded-control prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:my-2 prose-pre:rounded-xl prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground prose-blockquote:my-2 prose-blockquote:border-l-primary prose-blockquote:bg-transparent prose-blockquote:py-0.5 prose-blockquote:text-reading prose-blockquote:text-foreground dark:prose-invert ${isAssistant
          ? "prose-p:leading-7 prose-li:leading-7 prose-strong:font-black"
          : "prose-p:my-0 prose-ul:my-0 prose-ol:my-0"
          }`}
      >
        <Markdown remarkPlugins={[remarkGfm]} components={messageMermaidComponents}>{messageContent}</Markdown>
      </div>
    );
  }

  return null;
}

export function ThinkingPlaceholder() {
  return (
    <div
      className="flex items-center gap-2 py-1 motion-reduce:items-center"
      data-testid="thinking-placeholder"
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary animate-pulse motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span className="thinking-flow-text text-reading font-medium leading-7">
        正在思考...
      </span>
    </div>
  );
}
