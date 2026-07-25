// 用量页：左侧选用户，右侧展示该用户本周 token 用量进度条 + 订阅状态。
import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { surfaceVariants } from "@/lib/visualVariants";
import {
  getAdminUserUsage,
  listAdminUsers,
  type AdminUserItem,
  type AdminUserWeeklyUsage,
} from "@/api/client";
import { AdminPage, AdminPageHeader } from "./AdminPage";

// 周额度固定上限 100M tokens（展示用 M 单位，÷1e6 保留 1 位）。
const WEEKLY_LIMIT = 100_000_000;
const fmtM = (n: number): string => (n / 1e6).toFixed(1);

export function UsagePage() {
  // ---- 左：用户列表 ----
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // ---- 右：选中用户 ----
  const [selectedUserId, setSelectedUserId] = useState<number | undefined>(
    undefined,
  );

  // 拉取用户列表（仅一次）。初态即 loading，避免在 effect 体内同步 setState。
  useEffect(() => {
    let cancelled = false;
    listAdminUsers({ limit: 50 })
      .then((res) => {
        if (!cancelled) setUsers(res.items);
      })
      .catch((err: Error) => {
        if (!cancelled) setUsersError(err.message);
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.username.toLowerCase().includes(q));
  }, [users, search]);

  return (
    <AdminPage>
      <AdminPageHeader
        title="用量"
        description="按用户查看本周 token 消耗、剩余额度与订阅状态。"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* ---- 左：用户列表 ---- */}
        <Card className="flex flex-col overflow-hidden">
          <CardHeader className="pb-3 space-y-3">
            <CardTitle className="text-base">用户</CardTitle>
            <Input
              placeholder="搜索用户名"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-xl border-border/70 bg-background/60 shadow-none"
            />
          </CardHeader>
          <CardContent className="min-h-0">
            {usersLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                加载中…
              </p>
            ) : usersError ? (
              <p className="py-8 text-center text-sm text-destructive">
                {usersError}
              </p>
            ) : (
              <ScrollArea className="h-[60vh] pr-3">
                <div className="space-y-1">
                  {filteredUsers.map((u) => (
                    <Button
                      key={u.id}
                      variant="ghost"
                      onClick={() => setSelectedUserId(u.id)}
                      className={cn(
                        "h-auto w-full justify-start rounded-xl border border-transparent px-3 py-2 font-normal",
                        selectedUserId === u.id
                          ? cn(surfaceVariants({ variant: "selected" }), "text-primary")
                          : "hover:border-border/60 hover:bg-accent/55",
                      )}
                    >
                      <span className="flex flex-col items-start gap-0.5">
                        <span className="text-sm">{u.username}</span>
                        <span className="text-xs text-muted-foreground">
                          #{u.id}
                        </span>
                      </span>
                    </Button>
                  ))}
                  {filteredUsers.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      无匹配用户
                    </p>
                  )}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* ---- 右：详情 ---- */}
        <div className="min-w-0">
          {selectedUserId == null ? (
            <Card className="flex h-full min-h-[60vh] items-center justify-center">
              <CardContent className="py-20 text-center text-sm text-muted-foreground">
                请从左侧选择用户
              </CardContent>
            </Card>
          ) : (
            <UsageDetail key={selectedUserId} userId={selectedUserId} />
          )}
        </div>
      </div>
    </AdminPage>
  );
}

// 右侧详情：按 userId 拉取周用量。通过 key 在切换用户时整体重挂，
// 初态即 loading，故 effect 体内无需同步 setState（遵守 set-state-in-effect）。
function UsageDetail({ userId }: { userId: number }) {
  const [usage, setUsage] = useState<AdminUserWeeklyUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdminUserUsage(userId)
      .then((data) => {
        if (!cancelled) setUsage(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loading) {
    return (
      <Card className="min-h-[60vh]">
        <CardContent className="py-20 text-center text-sm text-muted-foreground">
          加载中…
        </CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card className="min-h-[60vh] border-destructive/20 bg-destructive/5 shadow-none">
        <CardContent className="py-20 text-center text-sm text-destructive">
          {error}
        </CardContent>
      </Card>
    );
  }
  if (!usage) return null;

  const pct = usage.limit > 0 ? (usage.used / usage.limit) * 100 : 0;
  const overWarn = pct > 80;

  return (
    <Card className="min-h-[60vh]">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg">{usage.username}</CardTitle>
          <Badge variant={usage.active ? "default" : "secondary"}>
            {usage.active ? "订阅生效" : "已过期"}
          </Badge>
        </div>
        <CardDescription>
          统计周期 <span className="font-mono">{usage.period}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">本周已用</span>
            <span className="text-sm">
              <span className="font-semibold">{fmtM(usage.used)}M</span>
              <span className="text-muted-foreground">
                {" "}
                / {fmtM(WEEKLY_LIMIT)}M
              </span>
            </span>
          </div>
          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-muted/80 shadow-inner"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                overWarn
                  ? "bg-destructive shadow-[0_0_14px_hsl(var(--destructive)/0.24)]"
                  : "bg-primary shadow-[0_0_14px_hsl(var(--primary)/0.24)]",
              )}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>剩余 {fmtM(usage.remaining)}M</span>
            <span className={overWarn ? "text-destructive font-medium" : ""}>
              {pct.toFixed(1)}%
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          周额度上限固定为 {fmtM(WEEKLY_LIMIT)}M tokens，超过 80% 显示警示色。
        </p>
      </CardContent>
    </Card>
  );
}
