import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight, Shield, ShieldOff } from "lucide-react";
import {
  listAdminUsers,
  grantAdminSubscription,
  setAdminUser,
} from "@/api/admin";
import type { AdminUserItem } from "@/api/admin";
import { formatDateTime } from "@/lib/datetime";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/stores/authStore";
import {
  ADMIN_DIALOG_CLASS,
  AdminPage,
  AdminPageHeader,
} from "./AdminPage";

const PAGE_SIZE = 20;

/** 用户管理：列表（搜索 + 分页）+ 延期订阅。 */
export function UsersPage() {
  const { user: currentUser } = useAuth();
  const canManageAdmins = Boolean(currentUser?.is_super_admin);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 延期订阅 Dialog
  const [extendUserId, setExtendUserId] = useState<number | null>(null);
  const [extendDays, setExtendDays] = useState(30);
  const [extending, setExtending] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);

  // 授权/撤销管理员（记录正在操作的用户 id，禁用按钮）
  const [adminToggling, setAdminToggling] = useState<number | null>(null);

  // 搜索输入防抖 ~300ms 后提交，并重置分页。
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput === search) return;
      setLoading(true);
      setSearch(searchInput);
      setOffset(0);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput, search]);

  // 拉取用户列表：await 前不 setState，避免 effect 内同步 setState。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await listAdminUsers({
          search: search ? search : undefined,
          offset,
          limit: PAGE_SIZE,
        });
        if (cancelled) return;
        setUsers(res.items);
        setTotal(res.total);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "加载用户列表失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search, offset, reloadNonce]);

  // 内联成功提示 4s 后自动消失。
  useEffect(() => {
    if (!success) return;
    const handle = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(handle);
  }, [success]);

  const handleOpenExtend = (userId: number) => {
    setExtendUserId(userId);
    setExtendDays(30);
    setExtendError(null);
  };

  const handleCloseExtend = () => {
    setExtendUserId(null);
    setExtendError(null);
  };

  const handleConfirmExtend = async () => {
    if (extendUserId == null) return;
    const raw = extendDays;
    if (!Number.isFinite(raw) || raw < 1) {
      setExtendError("请输入有效的天数（1-3650）");
      return;
    }
    const days = Math.min(3650, Math.floor(raw));
    const target = users.find((u) => u.id === extendUserId);
    setExtending(true);
    setExtendError(null);
    try {
      const res = await grantAdminSubscription(extendUserId, days);
      setSuccess(
        `已为 ${target?.username ?? extendUserId} 延期至 ${formatDateTime(
          res.subscription_expires_at,
        )}`,
      );
      handleCloseExtend();
      setReloadNonce((n) => n + 1);
    } catch (e) {
      setExtendError(e instanceof Error ? e.message : "延期订阅失败");
    } finally {
      setExtending(false);
    }
  };

  const handleToggleAdmin = async (u: AdminUserItem) => {
    if (u.is_admin) {
      const ok = window.confirm(`确认撤销 ${u.username} 的管理员身份？`);
      if (!ok) return;
    }
    setAdminToggling(u.id);
    try {
      await setAdminUser(u.id, !u.is_admin);
      setSuccess(`已${u.is_admin ? "撤销" : "授予"} ${u.username} 管理员身份`);
      setReloadNonce((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "设置管理员失败");
    } finally {
      setAdminToggling(null);
    }
  };

  const handlePrev = () => {
    setLoading(true);
    setOffset((o) => Math.max(0, o - PAGE_SIZE));
  };

  const handleNext = () => {
    setLoading(true);
    setOffset((o) => o + PAGE_SIZE);
  };

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setReloadNonce((n) => n + 1);
  };

  const shown = users.length;
  const rangeFrom = total > 0 ? offset + 1 : 0;
  const rangeTo = offset + shown;
  const hasPrev = offset > 0;
  const hasNext = offset + shown < total;
  const rangeText =
    total > 0 ? `第 ${rangeFrom}-${rangeTo} 条 / 共 ${total} 条` : "共 0 条";

  return (
    <AdminPage>
      <AdminPageHeader
        title="用户管理"
        description="查找用户、维护订阅有效期，并管理后台访问权限。"
      />

      {success && (
        <div className="rounded-panel border border-primary/20 bg-primary/8 px-4 py-3 text-body text-primary shadow-sm shadow-primary/5">
          {success}
        </div>
      )}

      <Card className="shadow-sm">
        <CardContent className="p-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索用户名"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="rounded-xl border-border/70 bg-background/60 pl-9 shadow-none"
              aria-label="搜索用户名"
            />
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="space-y-2">
          <Alert variant="destructive">
            {error}
          </Alert>
          <Button className="rounded-full" variant="outline" size="sm" onClick={handleRetry}>
            重试
          </Button>
        </div>
      ) : loading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-16 text-body text-muted-foreground">
            <Spinner className="h-4 w-4" /> 加载中...
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">用户名</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>订阅到期</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="pr-5 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      暂无用户
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="pl-5 font-medium">{u.username}</TableCell>
                      <TableCell>
                        {u.is_super_admin ? (
                          <Badge variant="secondary" className="rounded-full">超级管理员</Badge>
                        ) : u.is_admin ? (
                          <Badge className="rounded-full">管理员</Badge>
                        ) : (
                          <span className="text-muted-foreground">普通</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {u.subscription_expires_at
                          ? formatDateTime(u.subscription_expires_at)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {u.created_at
                          ? formatDateTime(u.created_at)
                          : "—"}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full"
                            onClick={() => handleOpenExtend(u.id)}
                          >
                            延期订阅
                          </Button>
                          {canManageAdmins && !u.is_super_admin && (u.is_admin ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-full text-destructive hover:text-destructive"
                              disabled={adminToggling === u.id}
                              onClick={() => handleToggleAdmin(u)}
                            >
                              <ShieldOff className="h-4 w-4" />
                              撤销管理员
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-full"
                              disabled={adminToggling === u.id}
                              onClick={() => handleToggleAdmin(u)}
                            >
                              <Shield className="h-4 w-4" />
                              设为管理员
                            </Button>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <div className="text-body text-muted-foreground">{rangeText}</div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                disabled={!hasPrev}
                onClick={handlePrev}
              >
                <ChevronLeft className="h-4 w-4" /> 上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                disabled={!hasNext}
                onClick={handleNext}
              >
                下一页 <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog
        open={extendUserId != null}
        onOpenChange={(open) => {
          if (!open) handleCloseExtend();
        }}
      >
        <DialogContent className={ADMIN_DIALOG_CLASS}>
          <DialogHeader>
            <DialogTitle>延期订阅</DialogTitle>
            <DialogDescription>
              为该用户延长订阅有效期（1-3650 天）。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-body font-medium" htmlFor="extend-days">
              延期天数
            </label>
            <Input
              id="extend-days"
              type="number"
              min={1}
              max={3650}
              value={extendDays}
              onChange={(e) => setExtendDays(Number(e.target.value))}
            />
            {extendError && (
              <p className="text-body text-destructive">{extendError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCloseExtend}
              disabled={extending}
            >
              取消
            </Button>
            <Button
              onClick={handleConfirmExtend}
              disabled={
                extending || !Number.isFinite(extendDays) || extendDays < 1
              }
            >
              {extending ? "处理中..." : "确认延期"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  );
}
