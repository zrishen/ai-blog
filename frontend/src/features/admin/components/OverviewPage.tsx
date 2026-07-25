import { useEffect, useState } from "react";
import {
  Users,
  Crown,
  Ticket,
  Zap,
  RefreshCw,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getAdminOverview, type AdminOverview } from "@/api/client";

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
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        <div className="h-4 w-4 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
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
    <div className="p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">管理后台 · 概览</h1>
        <p className="text-sm text-muted-foreground">
          汇总用户、订阅、兑换码与本周 token 用量，监控整体运行状态。
        </p>
      </div>

      {error ? (
        <Card>
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
                />
                <KpiCard
                  icon={Crown}
                  label="活跃订阅"
                  value={data.active_subscriptions.toLocaleString()}
                />
                <KpiCard
                  icon={Ticket}
                  label="兑换码"
                  value={`${data.codes_used.toLocaleString()} / ${data.codes_total.toLocaleString()}`}
                  hint="已用 / 共"
                />
                <KpiCard
                  icon={Zap}
                  label="本周 token"
                  value={formatM(data.this_week_tokens)}
                />
              </>
            )}
          </div>

          <WeeklyUsageCard loading={loading} data={data} />
        </>
      )}
    </div>
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
    <Card>
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
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  nearLimit ? "bg-destructive" : "bg-primary",
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
