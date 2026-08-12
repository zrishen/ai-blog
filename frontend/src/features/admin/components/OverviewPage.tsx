import { useState } from "react";
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
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getAdminOverview } from "@/api/admin";
import type { AdminOverview } from "@/api/admin";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { AdminPage, AdminPageHeader } from "./AdminPage";

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
        <CardTitle className="text-body font-medium text-muted-foreground">
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
        {hint ? <div className="mt-1 text-fine text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-5 pb-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-9 w-9 rounded-xl" />
      </CardHeader>
      <CardContent className="p-5 pt-0">
        <Skeleton className="h-7 w-24" />
      </CardContent>
    </Card>
  );
}

export function OverviewPage() {
  const { data, loading, error, retry: handleRetry } = useAsyncResource<AdminOverview>(
    () => getAdminOverview(),
    [],
  );

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
            <div className="flex-1 text-body">
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
          <Skeleton className="h-12 w-full rounded-panel" />
        ) : inviteCode ? (
          <div className="flex flex-col gap-3 rounded-panel border border-border/65 bg-background/55 p-3 sm:flex-row sm:items-center sm:justify-between">
            <code className="min-w-0 break-all px-1 font-mono text-body font-semibold tracking-wide text-foreground">
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
          <div className="rounded-panel border border-dashed border-border/70 bg-muted/25 px-4 py-5 text-body text-muted-foreground">
            当前未配置邀请码，新用户暂时无法注册。
          </div>
        )}
      </CardContent>
    </Card>
  );
}
