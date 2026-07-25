import { BarChart3, FileText, MessageSquare, Network, Sparkles, Users, Zap } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Surface } from "@/components/ui/surface";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { WorkspacePanel } from "@/components/ui/workspace-panel";
import { navItemVariants } from "@/lib/visualVariants";

type VisualScenario = "foundation" | "login" | "workspace" | "admin";

function requestedScenario(): VisualScenario {
  const scenario = new URLSearchParams(window.location.search).get("scenario");
  return scenario === "login" || scenario === "workspace" || scenario === "admin"
    ? scenario
    : "foundation";
}

function FoundationPreview() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Visual system</p>
        <h1 className="text-2xl font-semibold tracking-tight">基础控件视觉回归</h1>
        <p className="text-sm text-muted-foreground">按钮、输入、状态和层级使用同一套柔和的边界与焦点表达。</p>
      </header>

      <Surface className="grid gap-5 p-5 md:grid-cols-[1.25fr_0.75fr]">
        <section className="space-y-4" aria-label="表单控件">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button">保存变更</Button>
            <Button type="button" variant="outline">取消</Button>
            <Button type="button" variant="secondary">预览</Button>
            <Button type="button" variant="ghost">更多操作</Button>
          </div>

          <Tabs defaultValue="settings">
            <TabsList aria-label="样板分类">
              <TabsTrigger value="settings">设置</TabsTrigger>
              <TabsTrigger value="usage">用量</TabsTrigger>
            </TabsList>
            <TabsContent value="settings" className="space-y-3">
              <label className="block space-y-1.5" htmlFor="visual-title">
                <span className="text-sm font-medium">标题</span>
                <Input id="visual-title" defaultValue="本周内容计划" />
              </label>
              <label className="block space-y-1.5" htmlFor="visual-protocol">
                <span className="text-sm font-medium">协议</span>
                <Select id="visual-protocol" defaultValue="openai">
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </Select>
              </label>
              <label className="block space-y-1.5" htmlFor="visual-note">
                <span className="text-sm font-medium">备注</span>
                <Textarea id="visual-note" defaultValue="保持内容结构清晰，重点说明可执行的工作流。" />
              </label>
            </TabsContent>
            <TabsContent value="usage" className="text-sm text-muted-foreground">本周已使用 32.4M token。</TabsContent>
          </Tabs>
        </section>

        <section className="space-y-3" aria-label="状态样式">
          <div className="flex flex-wrap gap-2">
            <Badge>处理中</Badge>
            <Badge variant="success">已完成</Badge>
            <Badge variant="warning">即将用尽</Badge>
            <Badge variant="destructive">需要处理</Badge>
          </div>
          <Alert variant="success">
            <AlertTitle>设置已保存</AlertTitle>
            <AlertDescription>下一次 AI 调用会使用新的模型配置。</AlertDescription>
          </Alert>
          <Alert variant="warning">
            <AlertTitle>本周额度提醒</AlertTitle>
            <AlertDescription>请在需要时调整订阅或等待下一个周期。</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>连接失败</AlertTitle>
            <AlertDescription>请检查服务地址后重试。</AlertDescription>
          </Alert>
        </section>
      </Surface>
    </div>
  );
}

function LoginPreview() {
  return (
    <div className="flex min-h-[650px] items-center justify-center">
      <Surface className="w-full max-w-md p-6 shadow-surface-raised">
        <header className="mb-5 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Welcome back</p>
          <h1 className="text-2xl font-semibold tracking-tight">登录到 AI Blog</h1>
          <p className="text-sm text-muted-foreground">继续管理写作、知识库和研究内容。</p>
        </header>
        <Tabs defaultValue="login" variant="underline">
          <TabsList className="grid grid-cols-2" aria-label="身份验证方式">
            <TabsTrigger value="login">登录</TabsTrigger>
            <TabsTrigger value="register">注册</TabsTrigger>
          </TabsList>
          <TabsContent value="login" className="space-y-4">
            <label className="block space-y-1.5" htmlFor="visual-login-username">
              <span className="text-sm font-medium">用户名</span>
              <Input id="visual-login-username" defaultValue="guangbing" />
            </label>
            <label className="block space-y-1.5" htmlFor="visual-login-password">
              <span className="text-sm font-medium">密码</span>
              <Input id="visual-login-password" type="password" defaultValue="password" />
            </label>
            <Button type="button" className="w-full">登录</Button>
          </TabsContent>
        </Tabs>
      </Surface>
    </div>
  );
}

function WorkspacePreview() {
  return (
    <div className="mx-auto max-w-6xl">
      <div className="grid min-h-[650px] overflow-hidden rounded-shell border border-border/70 bg-card/86 shadow-surface md:grid-cols-[210px_minmax(0,1fr)_250px]">
        <WorkspacePanel side="left" className="gap-4 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Workspace</p>
            <p className="mt-1 text-sm font-semibold">我的主页</p>
          </div>
          <nav className="space-y-1" aria-label="工作区导航">
            <button type="button" className={navItemVariants({ layout: "side", state: "active" })}><Sparkles className="h-4 w-4" />首页</button>
            <button type="button" className={navItemVariants({ layout: "side", state: "idle" })}><FileText className="h-4 w-4" />文件库</button>
            <button type="button" className={navItemVariants({ layout: "side", state: "idle" })}><Network className="h-4 w-4" />研究图谱</button>
          </nav>
          <div className="mt-auto rounded-panel border border-border/60 bg-background/55 p-3 text-xs text-muted-foreground">3 篇草稿 · 本周 0.0M token</div>
        </WorkspacePanel>

        <section className="min-w-0 space-y-4 bg-background/45 p-5">
          <header className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Overview</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">写作工作台</h1>
              <p className="mt-1 text-sm text-muted-foreground">把灵感、资料和文章放在同一个清晰的流程里。</p>
            </div>
            <Button size="sm">新建文章</Button>
          </header>
          <Surface variant="featured" className="p-5">
            <div className="flex flex-wrap gap-2"><Badge>草稿</Badge><Badge variant="success">已整理</Badge><Badge variant="outline">AI 协作</Badge></div>
            <h2 className="mt-4 text-xl font-semibold">从“会用”到“用好”：个人 AI 工作流</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">先明确读者与目标，再逐步整理素材、生成大纲并回收反馈。</p>
          </Surface>
          <div className="grid gap-3 sm:grid-cols-2">
            <Surface variant="interactive" className="p-4"><p className="text-sm font-medium">待完善：研究提纲</p><p className="mt-1 text-xs text-muted-foreground">7 月 25 日 · 19 次引用</p></Surface>
            <Surface variant="interactive" className="p-4"><p className="text-sm font-medium">可信使用指南</p><p className="mt-1 text-xs text-muted-foreground">7 月 25 日 · 11 次引用</p></Surface>
          </div>
        </section>

        <WorkspacePanel side="right" className="p-4">
          <div className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-control bg-primary/10 text-primary"><MessageSquare className="size-4" /></span><div><p className="text-sm font-semibold">AI 助手</p><p className="text-xs text-muted-foreground">当前文章上下文</p></div></div>
          <div className="mt-6 space-y-3 text-sm"><div className="rounded-panel bg-muted/65 p-3">我可以帮你整理选题或继续写作。</div><div className="ml-6 rounded-panel border border-border/60 bg-background/65 p-3">帮我列一个可执行的大纲。</div></div>
          <div className="mt-auto rounded-shell border border-border/70 bg-background/78 p-2 text-sm text-muted-foreground">想写什么，尽管说</div>
        </WorkspacePanel>
      </div>
    </div>
  );
}

function AdminPreview() {
  const metrics = [
    [Users, "用户总数", "3", "bg-primary/10 text-primary"],
    [Sparkles, "活跃订阅", "2", "bg-warning/10 text-warning-foreground"],
    [BarChart3, "兑换码", "0 / 0", "bg-primary/10 text-primary"],
    [Zap, "本周 token", "0.0M", "bg-success/10 text-success"],
  ] as const;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Admin console</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">概览</h1>
        <p className="mt-1 text-sm text-muted-foreground">汇总用户、订阅、邀请码与全站用量。</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map(([Icon, label, value, tone]) => (
          <Card key={label} className="shadow-none">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-5 pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle><span className={`flex size-9 items-center justify-center rounded-control ${tone}`}><Icon className="size-[18px]" /></span></CardHeader>
            <CardContent className="p-5 pt-0"><div className="text-2xl font-semibold tracking-[-0.035em] tabular-nums">{value}</div></CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>本周用量</CardTitle><p className="text-sm text-muted-foreground">全站本周 token 消耗占周额度（100.0M）的比例。</p></CardHeader>
        <CardContent><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full w-[12%] rounded-full bg-primary" /></div><div className="mt-3 flex justify-between text-sm text-muted-foreground"><span>已用 12.0M / 100.0M</span><span>占比 12.0%</span></div></CardContent>
      </Card>
    </div>
  );
}

/** 仅开发环境视觉回归使用，正式路由不会挂载此组件。 */
export function VisualRegressionRoute() {
  const scenario = requestedScenario();
  const content = scenario === "login"
    ? <LoginPreview />
    : scenario === "workspace"
      ? <WorkspacePreview />
      : scenario === "admin"
        ? <AdminPreview />
        : <FoundationPreview />;

  return (
    <main data-visual-regression data-visual-scenario={scenario} className="min-h-full bg-background px-8 py-10 text-foreground">
      {content}
    </main>
  );
}
