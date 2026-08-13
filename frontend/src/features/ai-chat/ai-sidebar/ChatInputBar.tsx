import { useRef } from "react";
import {
  Plus,
  Blocks,
  ArrowUp,
  Square,
  Paperclip,
  Sparkles,
} from "lucide-react";

import { AttachmentDraftList } from "./AttachmentDraftList";

import type { DraftAttachment } from "@/types/chat";

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
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSend: () => void;
  onStop: () => void;
  attachments: DraftAttachment[];
  attachmentsEnabled: boolean;
  sendDisabled: boolean;
  getAttachmentPreviewUrl: (localId: string) => string | undefined;
  onSelectAttachments: (files: FileList) => void;
  onRetryAttachment: (localId: string) => void;
  onRemoveAttachment: (localId: string) => void;
  onOpenPlugins: () => void;
  onOpenSkills: () => void;
}

export function ChatInputBar({
  streaming,
  input,
  textareaRef,
  onInputChange,
  onKeyDown,
  onSend,
  onStop,
  attachments,
  attachmentsEnabled,
  sendDisabled,
  getAttachmentPreviewUrl,
  onSelectAttachments,
  onRetryAttachment,
  onRemoveAttachment,
  onOpenPlugins,
  onOpenSkills,
}: ChatInputBarProps) {
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!attachmentsEnabled || event.clipboardData.files.length === 0) return;
    event.preventDefault();
    onSelectAttachments(event.clipboardData.files);
  };

  return (
    <div className="mx-3 mb-3 flex flex-col gap-2">
      <input
        ref={attachmentInputRef}
        id="ai-sidebar-attachment-input"
        className="sr-only"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,.pdf,.docx,.xlsx,.txt,.md"
        disabled={!attachmentsEnabled}
        onChange={(event) => {
          if (event.target.files) onSelectAttachments(event.target.files);
          event.target.value = "";
        }}
      />
      <AttachmentDraftList
        attachments={attachments}
        disabled={streaming}
        getPreviewUrl={getAttachmentPreviewUrl}
        onRetry={onRetryAttachment}
        onRemove={onRemoveAttachment}
      />
      <div
        data-testid="ai-chat-composer"
        className="rounded-shell border border-border/70 bg-background/78 p-1.5 shadow-lg shadow-foreground/5 transition-all duration-200 focus-within:border-border/70 focus-within:shadow-foreground/5"
      >
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
          <DropdownMenuContent side="top" align="start" className="w-48">
            <DropdownMenuItem
              disabled={!attachmentsEnabled}
              onSelect={(event) => {
                event.preventDefault();
                attachmentInputRef.current?.click();
              }}
            >
              <Paperclip className="mr-2 h-4 w-4" />
              上传文件
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenPlugins}>
              <Blocks className="mr-2 h-4 w-4" />
              插件
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenSkills}>
              <Sparkles className="mr-2 h-4 w-4" />
              skill
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Textarea
          ref={textareaRef}
          className="min-h-[40px] max-h-[88px] flex-1 resize-none border-none bg-transparent px-2 py-2 text-body leading-relaxed text-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
          placeholder="想写什么，尽管说"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          rows={1}
        />
        <Button
          className={
            streaming
              ? "h-9 w-9 flex-shrink-0 rounded-full bg-destructive/15 text-destructive shadow-md shadow-destructive/10 hover:bg-destructive/25"
              : "h-9 w-9 flex-shrink-0 rounded-full shadow-md shadow-primary/20"
          }
          onClick={streaming ? onStop : onSend}
          disabled={!streaming && sendDisabled}
          title={streaming ? "停止生成" : "发送消息"}
          aria-label={streaming ? "停止生成" : "发送消息"}
        >
          {streaming ? <Square className="h-3.5 w-3.5" /> : <ArrowUp className="h-4 w-4" />}
        </Button>
        </div>
      </div>
    </div>
  );
}
