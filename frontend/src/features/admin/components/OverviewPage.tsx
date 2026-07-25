import { useEffect, useState } from "react";
import {
  Users,
  Crown,
  Ticket,
  Zap,
  RefreshCw,
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getAdminOverview, type AdminOverview } from "@/api/client";
import { AdminPage, AdminPageHeader } from "./AdminPage";

// 周额度上限固定 100M tokens
const WEEKLY_LIMIT = 100_000_000;

function formatM(n: number): string {
  return `${(n / 1e6).toFixed(1)}M`;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone: string;
}) {
  return (
    <Card className="group transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-2xl hover:shadow-foreground/7">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-5 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", tone)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </CardHeader>
      <CardContent className="p-5 pt-0">
        <div className="text-2xl font-semibold tracking-[-0.035em] tabular-nums">
          {value}
        </div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-5 pb-2">
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
      </CardHeader>
      <CardContent className="p-5 pt-0">
        <div className="h-7 w-24 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

export function OverviewPage() {
  // 初次即 loading，避免在 effect 内同步 setState 触发 react-hooks/set-state-in-effect。
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // 拉取：在 effect 内定义 async 函数并调用，使 set-state-in-effect 能识别 await 边界
  //（所有 setState 都在 await getAdminOverview() 之后的异步续段中）。
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const overview = await getAdminOverview();
        if (!cancelled) {
          setData(overview);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "读取概览失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  // 重试：在事件回调里翻转 loading/error 与 retryKey（事件回调可自由 setState），触发 effect 重跑。
  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setRetryKey((k) => k + 1);
  };

  return (
    <AdminPage>
      <AdminPageHeader
        title="概览"
        description="汇总用户、订阅、兑换码与本周 token 用量，快速掌握整体运行状态。"
      />

      {error ? (
        <Card className="border-destructive/20 bg-destructive/5 shadow-none">
          <CardContent className="flex items-center gap-3 p-6 text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div className="flex-1 text-sm">
              {error}
            </div>
            <Button variant="outline" size="sm" onClick={handleRetry}>
              <RefreshCw className="h-4 w-4" />
              重试
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {loading || !data ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : (
              <>
                <KpiCard
                  icon={Users}
                  label="用户总数"
                  value={data.total_users.toLocaleString()}
                  tone="bg-primary/10 text-primary"
                />
                <KpiCard
                  icon={Crown}
                  label="活跃订阅"
                  value={data.active_subscriptions.toLocaleString()}
                  tone="bg-amber-500/10 text-amber-600 dark:text-amber-400"
                />
                <KpiCard
                  icon={Ticket}
                  label="兑换码"
                  value={`${data.codes_used.toLocaleString()} / ${data.codes_total.toLocaleString()}`}
                  hint="已用 / 共"
                  tone="bg-violet-500/10 text-violet-600 dark:text-violet-400"
                />
                <KpiCard
                  icon={Zap}
                  label="本周 token"
                  value={formatM(data.this_week_tokens)}
                  tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                />
              </>
            )}
          </div>

          <InviteCodeCard
            loading={loading}
            inviteCode={data?.registration_invite_code ?? null}
          />

          <WeeklyUsageCard loading={loading} data={data} />
        </>
      )}
    </AdminPage>
  );
}

function InviteCodeCard({
  loading,
  inviteCode,
}: {
  loading: boolean;
  inviteCode: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <KeyRound className="h-[18px] w-[18px]" />
            </span>
            注册邀请码
          </CardTitle>
          <CardDescription>
            新用户注册时需要填写，邀请码未配置时注册入口关闭。
          </CardDescription>
        </div>
        {!loading && (
          <Badge
            variant={inviteCode ? "default" : "secondary"}
            className="shrink-0 rounded-full"
          >
            {inviteCode ? "注册开放" : "注册关闭"}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-12 w-full animate-pulse rounded-2xl bg-muted" />
        ) : inviteCode ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-border/65 bg-background/55 p-3 sm:flex-row sm:items-center sm:justify-between">
            <code className="min-w-0 break-all px-1 font-mono text-sm font-semibold tracking-wide text-foreground">
              {inviteCode}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 rounded-full bg-card/80 shadow-none"
              onClick={handleCopy}
              aria-label={copied ? "邀请码已复制" : "复制邀请码"}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "已复制" : "复制"}
            </Button>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border/70 bg-muted/25 px-4 py-5 text-sm text-muted-foreground">
            当前未配置邀请码，新用户暂时无法注册。
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WeeklyUsageCard({
  loading,
  data,
}: {
  loading: boolean;
  data: AdminOverview | null;
}) {
  const used = data?.this_week_tokens ?? 0;
  const pct = Math.min(100, (used / WEEKLY_LIMIT) * 100);
  const remaining = Math.max(0, WEEKLY_LIMIT - used);
  const nearLimit = pct > 80;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>本周用量</CardTitle>
        <CardDescription>
          全站本周 token 消耗占周额度（{formatM(WEEKLY_LIMIT)}）的占比。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !data ? (
          <div className="space-y-3">
            <div className="h-3 w-full animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          </div>
        ) : (
          <>
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted/80 shadow-inner">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  nearLimit
                    ? "bg-destructive shadow-[0_0_16px_hsl(var(--destructive)/0.25)]"
                    : "bg-primary shadow-[0_0_16px_hsl(var(--primary)/0.25)]",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div
              className={cn(
                "flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm",
                nearLimit ? "text-destructive" : "text-muted-foreground",
              )}
            >
              <span>
                已用 <span className="font-medium text-foreground tabular-nums">{formatM(used)}</span>
                {" "}/ {formatM(WEEKLY_LIMIT)}
              </span>
              <span>
                剩余 <span className="font-medium text-foreground tabular-nums">{formatM(remaining)}</span>
              </span>
              <span className="tabular-nums">
                占比 {pct.toFixed(1)}%
                {nearLimit ? " · 接近上限" : ""}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
