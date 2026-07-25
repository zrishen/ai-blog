import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Surface } from "@/components/ui/surface";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

/** 仅开发环境截图回归使用，正式路由不会挂载此组件。 */
export function VisualRegressionRoute() {
  return (
    <main
      data-visual-regression
      className="min-h-full bg-background px-8 py-10 text-foreground"
    >
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Visual system</p>
          <h1 className="text-2xl font-semibold tracking-tight">基础控件视觉回归</h1>
          <p className="text-sm text-muted-foreground">按钮、输入、状态和层级应使用同一套柔和的边界与焦点表达。</p>
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
              <AlertDescription>请在需要时调整订阅或等待下个周期。</AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertTitle>连接失败</AlertTitle>
              <AlertDescription>请检查服务地址后重试。</AlertDescription>
            </Alert>
          </section>
        </Surface>
      </div>
    </main>
  );
}
