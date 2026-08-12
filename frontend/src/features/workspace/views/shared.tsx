import { ArrowLeft } from "lucide-react";

import type { ComponentType, ReactNode } from "react";

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

// 二级页面顶部栏：与文章编辑收缩态工具栏同规格——单行、px-2.5 pt-1.5 pb-0.5、h-7 控件、无下边框。
// 目前只挂返回（标题/操作暂不上）。
export function SubPageHeader({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-0.5 pt-1.5 text-fine">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 rounded-full px-2 text-body text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="w-3 h-3" />
        返回
      </Button>
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
  icon?: ComponentType<{ className?: string }>;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 items-center gap-2 border-b border-border/60 px-1 text-meta font-semibold text-foreground">
        {Icon ? <Icon className="h-4 w-4 text-primary" /> : null}
        <span className="flex-1">{title}</span>
        {actions}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">{children}</div>
    </section>
  );
}
