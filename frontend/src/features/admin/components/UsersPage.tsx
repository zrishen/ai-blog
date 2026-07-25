import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight, Loader2, Shield, ShieldOff } from "lucide-react";
import {
  listAdminUsers,
  grantAdminSubscription,
  setAdminUser,
  type AdminUserItem,
} from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

const PAGE_SIZE = 20;

/** 用户管理：列表（搜索 + 分页）+ 延期订阅。 */
export function UsersPage() {
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
      setLoading(true);
      setSearch(searchInput);
      setOffset(0);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

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
        `已为 ${target?.username ?? extendUserId} 延期至 ${new Date(
          res.subscription_expires_at,
        ).toLocaleString()}`,
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
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">用户管理</h1>

      {success && (
        <div className="rounded-md border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary">
          {success}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索用户名"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-8"
            aria-label="搜索用户名"
          />
        </div>
      </div>

      {error ? (
        <div className="space-y-2">
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
          <Button variant="outline" size="sm" onClick={handleRetry}>
            重试
          </Button>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 加载中...
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户名</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>订阅到期</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
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
                      <TableCell className="font-medium">{u.username}</TableCell>
                      <TableCell>
                        {u.is_admin ? (
                          <Badge>管理员</Badge>
                        ) : (
                          <span className="text-muted-foreground">普通</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {u.subscription_expires_at
                          ? new Date(u.subscription_expires_at).toLocaleString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {u.created_at
                          ? new Date(u.created_at).toLocaleString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenExtend(u.id)}
                          >
                            延期订阅
                          </Button>
                          {u.is_admin ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive hover:text-destructive"
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
                              disabled={adminToggling === u.id}
                              onClick={() => handleToggleAdmin(u)}
                            >
                              <Shield className="h-4 w-4" />
                              设为管理员
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{rangeText}</div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasPrev}
                onClick={handlePrev}
              >
                <ChevronLeft className="h-4 w-4" /> 上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>延期订阅</DialogTitle>
            <DialogDescription>
              为该用户延长订阅有效期（1-3650 天）。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="extend-days">
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
              <p className="text-sm text-destructive">{extendError}</p>
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
    </div>
  );
}
