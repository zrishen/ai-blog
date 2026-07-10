import {
  Plus,
  Library,
  GitBranch,
  Wrench,
  ArrowUp,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ChatInputBarProps {
  streaming: boolean;
  input: string;
  topicCreateMode: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSend: () => void;
  onStop: () => void;
  onPickFiles: () => void;
  onPickResearch: () => void;
  onOpenMcp: () => void;
}

export function ChatInputBar({
  streaming,
  input,
  topicCreateMode,
  textareaRef,
  onInputChange,
  onKeyDown,
  onSend,
  onStop,
  onPickFiles,
  onPickResearch,
  onOpenMcp,
}: ChatInputBarProps) {
  return (
    <div className="mx-3 mb-3 rounded-[1.8rem] border border-border/70 bg-background/78 p-1.5 shadow-lg shadow-foreground/5 transition-all duration-200 focus-within:border-border/70 focus-within:shadow-foreground/5">
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-9 w-9 flex-shrink-0 rounded-full p-0 text-muted-foreground hover:bg-accent/70 hover:text-foreground"
              title="添加内容"
              aria-label="添加内容"
            >
              <Plus className="h-6 w-6" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-44">
            <DropdownMenuItem onClick={onPickFiles}>
              <Library className="mr-2 h-4 w-4" />
              文件库
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onPickResearch}>
              <GitBranch className="mr-2 h-4 w-4" />
              研究图谱
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenMcp}>
              <Wrench className="mr-2 h-4 w-4" />
              MCP 服务
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Textarea
          ref={textareaRef}
          className="min-h-[40px] max-h-[88px] flex-1 resize-none border-none bg-transparent px-2 py-2 text-sm leading-relaxed text-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
          placeholder={
            topicCreateMode ? "输入新研究主题名称，Enter 创建..." : "想写什么，尽管说"
          }
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
        />
        <Button
          className={
            streaming
              ? "h-9 w-9 flex-shrink-0 rounded-full bg-destructive/15 text-destructive shadow-md shadow-destructive/10 hover:bg-destructive/25"
              : "h-9 w-9 flex-shrink-0 rounded-full shadow-md shadow-primary/20"
          }
          onClick={streaming ? onStop : onSend}
          disabled={!streaming && !input.trim()}
          title={streaming ? "停止生成" : "发送消息"}
          aria-label={streaming ? "停止生成" : "发送消息"}
        >
          {streaming ? <Square className="h-3.5 w-3.5" /> : <ArrowUp className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
