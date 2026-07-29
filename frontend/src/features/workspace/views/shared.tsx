import type { ReactNode } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function LoadingState({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 py-16 text-meta text-muted-foreground">
      <Spinner className="h-4 w-4" />
      {label}
    </div>
  );
}

// 工作区中栏视图统一外壳：外缘贴边（无 gap）、白底（bg-card）、内容 px-4 py-4 呼吸。
// header 槽渲染在 padding 区外（贴顶、border-b 全宽），对应文章编辑区贴顶工具栏；
// children 仍在 px-4 py-4 内呼吸。所有工作区视图复用，保证中栏布局一致。
export function WorkspaceView({
  children,
  header,
  className,
}: {
  children: ReactNode;
  header?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col flex-1 h-full overflow-y-auto bg-card", className)}>
      {header}
      <div className="flex flex-col flex-1 min-h-0 gap-4 px-4 py-4">{children}</div>
    </div>
  );
}

// 二级页面顶部栏：复刻文章编辑 toolbar 布局——返回+操作在上（mb-4 行，返回单独左对齐），
// 标题在返回行下方（只读，text-body-lg），flex 自适应换行。
export function SubPageHeader({
  title,
  onBack,
  actions,
}: {
  title?: ReactNode;
  onBack: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="border-b border-border/70 p-2">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          className="rounded-full text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Button>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {title ? (
        <div className="min-w-0 truncate text-body-lg font-semibold text-foreground">{title}</div>
      ) : null}
    </div>
  );
}

// 扁平内容区：border-b 标题栏 + 滚动内容。去掉 Surface 卡片外壳，贴边风格下替代浮起卡片。
export function SectionCard({
  title,
  icon: Icon,
  actions,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-1 pb-2 text-meta font-semibold text-foreground">
        {Icon ? <Icon className="h-4 w-4 text-primary" /> : null}
        <span className="flex-1">{title}</span>
        {actions}
      </div>
      <div className="flex-1 overflow-y-auto py-1">{children}</div>
    </section>
  );
}
