import { ArrowLeft, Archive, Eye, FolderOpen, Image as ImageIcon, Save, Tags, Upload, Wand2, X } from "lucide-react";

import { useBlogCover } from "../hooks/useBlogCover";
import { useRevisionHistoryPanel } from "../hooks/useRevisionHistoryPanel";
import { DEFAULT_COVERS } from "../utils/blogEditorTypes";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { surfaceVariants } from "@/lib/visualVariants";


interface BlogToolbarProps {
  compact: boolean;
  title: string;
  onTitleChange: (value: string) => void;
  onCancel: () => void;
  onPreview: () => void;
  onPublish: () => void;
  isPublishedPost: boolean;
  activeSaveTarget: "draft" | "published" | null;
  historyButtonRef: React.RefObject<HTMLDivElement | null>;
  revisionPanel: ReturnType<typeof useRevisionHistoryPanel>;
  // 展开态附加区：标签/字数/封面
  tags: string;
  onTagsChange: (value: string) => void;
  content: string;
  wordCount: number;
  lineCount: number;
  coverImage: string;
  onCoverChange: (value: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  cover: Pick<
    ReturnType<typeof useBlogCover>,
    "generatingCover" | "uploadingCover" | "tagGenerating" | "handleUploadCover" | "handleGenerateCover" | "handleSuggestTags"
  >;
}

// 编辑器折叠工具栏：返回/标题/历史/预览/发布，compact 紧凑行 ↔ expanded 大卡片（含标签/封面设置）共用一份渲染
export function BlogToolbar({
  compact,
  title,
  onTitleChange,
  onCancel,
  onPreview,
  onPublish,
  isPublishedPost,
  activeSaveTarget,
  historyButtonRef,
  revisionPanel,
  tags,
  onTagsChange,
  content,
  wordCount,
  lineCount,
  coverImage,
  onCoverChange,
  fileInputRef,
  cover,
}: BlogToolbarProps) {
  const iconClass = compact ? "w-3 h-3" : "w-4 h-4";
  const btnSize = compact ? "sm" : undefined;
  const saveDisabled = revisionPanel.saving || revisionPanel.revisionBusy || revisionPanel.checkingRevisionLimit;
  const historyDisabled = revisionPanel.historyDisabled;
  const showHistory = revisionPanel.showHistory;
  const onToggleHistory = revisionPanel.toggleHistory;

  const cancelButton = (
    <Button
      variant="ghost"
      size={btnSize}
      className={compact ? "h-7 rounded-full px-2 text-body text-muted-foreground hover:text-foreground" : "rounded-full text-muted-foreground hover:text-foreground"}
      onClick={onCancel}
    >
      <ArrowLeft className={iconClass} />
      返回
    </Button>
  );
  const historyButton = (
    <Button
      variant="outline"
      size={btnSize}
      className={compact ? "h-7 rounded-full px-2 text-body" : "rounded-full bg-background/70"}
      onClick={onToggleHistory}
      disabled={historyDisabled}
      aria-expanded={showHistory}
      aria-controls="blog-history-popover"
    >
      <Archive className={iconClass} />
      历史
    </Button>
  );
  const previewButton = (
    <Button
      variant="outline"
      size={btnSize}
      className={compact ? "h-7 rounded-full px-2 text-body" : "rounded-full bg-background/70"}
      onClick={onPreview}
    >
      <Eye className={iconClass} />
      预览
    </Button>
  );
  const publishButton = (
    <Button
      size={btnSize}
      className={compact ? "h-7 w-20 rounded-full px-2 text-body" : "w-20 rounded-full px-2 shadow-lg shadow-primary/20"}
      onClick={onPublish}
      disabled={saveDisabled}
    >
      <Save className={iconClass} />
      {activeSaveTarget === "published" ? (isPublishedPost ? "更新中" : "发布中") : isPublishedPost ? "更新" : "发布"}
    </Button>
  );
  const titleInput = (
    <Input
      className={compact
        ? "h-7 min-w-[120px] flex-1 appearance-none rounded-full border border-solid border-input bg-background shadow-sm px-3 text-body text-foreground placeholder:text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        : "h-auto w-full rounded-surface border border-primary/20 bg-card/95 px-5 py-2 text-2xl font-black tracking-[-0.05em] text-foreground shadow-lg shadow-primary/10 transition-all placeholder:text-muted-foreground/80 focus-visible:border-primary/50 focus-visible:ring-4 focus-visible:ring-primary/15 sm:text-2xl md:text-2xl"}
      placeholder="输入文章标题..."
      value={title}
      onChange={(e) => onTitleChange(e.target.value)}
    />
  );

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-0.5 pt-1.5 text-body">
        {cancelButton}
        {titleInput}
        <div ref={historyButtonRef}>
          {historyButton}
        </div>
        {previewButton}
        {publishButton}
      </div>
    );
  }

  return (
    <div className="border-b border-border/70 p-2">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {cancelButton}
        <div className="flex flex-wrap items-center gap-2">
          <div ref={historyButtonRef}>
            {historyButton}
          </div>
          {previewButton}
          {publishButton}
        </div>
      </div>
      {titleInput}

      <div className="mt-2 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-0 flex-1 basis-full sm:min-w-[220px] sm:basis-auto">
          <Tags className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 rounded-full border-border bg-secondary/65 pl-9 pr-20 text-body shadow-none"
            placeholder="标签（逗号分隔）"
            value={tags}
            onChange={(e) => onTagsChange(e.target.value)}
          />
          <Button
            variant="ghost"
            size="sm"
            className={`absolute right-1 top-1/2 h-7 -translate-y-1/2 rounded-full px-2 text-fine ${
              cover.tagGenerating || !content.trim() ? "opacity-50 cursor-not-allowed" : ""
            }`}
            onClick={() => void cover.handleSuggestTags()}
            disabled={cover.tagGenerating || !content.trim()}
          >
            <Wand2 className={`mr-1 h-3 w-3 ${cover.tagGenerating ? "animate-spin" : ""}`} />
            {cover.tagGenerating ? "生成中..." : "AI 生成"}
          </Button>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-background/70 px-3 py-2 text-fine text-muted-foreground">
          <FolderOpen className="w-3.5 h-3.5" />
          {wordCount} 字 · {lineCount} 行
        </span>
      </div>

      <div className="mt-2 rounded-surface border border-border/70 bg-background/56 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="inline-flex items-center gap-2 text-body font-bold text-foreground">
              <ImageIcon className="h-4 w-4 text-primary" />
              文章封面
            </div>
            <p className="mt-1 text-fine text-muted-foreground">可使用 AI 生成、上传图片、选择默认图，也可以不设置封面。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => void cover.handleUploadCover(e)} />
            <Button variant="outline" size="sm" className="rounded-full" disabled={cover.uploadingCover} onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" />
              {cover.uploadingCover ? "上传中..." : "上传图片"}
            </Button>
            <Button variant="outline" size="sm" className="rounded-full" disabled={cover.generatingCover} onClick={() => void cover.handleGenerateCover()}>
              <Wand2 className={`h-3.5 w-3.5 ${cover.generatingCover ? "animate-spin" : ""}`} />
              {cover.generatingCover ? "生成中..." : "AI 生成"}
            </Button>
            {coverImage && (
              <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => onCoverChange("")}>
                <X className="h-3.5 w-3.5" />
                移除图片
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {DEFAULT_COVERS.map((coverUrl, index) => (
              <button
                key={coverUrl}
                type="button"
                className={cn(
                  surfaceVariants({ variant: coverImage === coverUrl ? "selected" : "interactive" }),
                  "h-16 w-28 flex-shrink-0 overflow-hidden rounded-panel",
                  coverImage === coverUrl ? "ring-2 ring-foreground/10" : "bg-card",
                )}
                onClick={() => onCoverChange(coverUrl)}
                aria-label={`选择默认封面 ${index + 1}`}
              >
                <img src={coverUrl} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
          <div className="min-h-28 overflow-hidden rounded-panel border border-border/70 bg-card/86">
            {coverImage ? (
              <img src={coverImage} alt="当前封面" className="h-full min-h-28 w-full object-cover" />
            ) : (
              <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 border border-dashed border-border/80 text-fine text-muted-foreground">
                <ImageIcon className="h-5 w-5" />
                无封面，发布后白底显示
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
