import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Plus, Trash2 } from "lucide-react";
import {
  generateAdminCodes,
  listAdminCodes,
  revokeAdminCode,
} from "@/api/admin";
import type { AdminCodeItem } from "@/api/admin";
import { formatDateTime as formatBjDateTime } from "@/lib/datetime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ADMIN_DIALOG_CLASS,
  AdminPage,
  AdminPageHeader,
} from "./AdminPage";

const PAGE_SIZE = 20;

function clampNumber(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return formatBjDateTime(iso);
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * 兑换码管理页：批量生成（明文仅展示一次）+ 列表（全部/未使用/已使用 筛选 + 分页）+ 作废。
 */
export function CodesPage() {
  // ---- 列表 ----
  const [filter, setFilter] = useState<boolean | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<AdminCodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // 仅在异步回调里 setState（避免在 effect 体内同步 setState 触发级联渲染）；
  // loading/error 的“置位”放到触发本次拉取的事件处理器里（见 startReload）。
  useEffect(() => {
    let cancelled = false;
    listAdminCodes({ used: filter, offset, limit: PAGE_SIZE })
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e, "读取兑换码列表失败"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, offset, refreshKey]);

  function startReload() {
    setLoading(true);
    setError(null);
  }

  function changeFilter(f: boolean | undefined) {
    startReload();
    setFilter(f);
    setOffset(0);
  }

  function goPrev() {
    startReload();
    setOffset((o) => Math.max(0, o - PAGE_SIZE));
  }

  function goNext() {
    startReload();
    setOffset((o) => o + PAGE_SIZE);
  }

  // ---- 生成对话框 ----
  const [genOpen, setGenOpen] = useState(false);
  const [genCount, setGenCount] = useState(1);
  const [genDays, setGenDays] = useState(30);
  const [genNote, setGenNote] = useState("");
  const [genSubmitting, setGenSubmitting] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // ---- 结果对话框（明文仅一次）----
  const [resultOpen, setResultOpen] = useState(false);
  const [resultCodes, setResultCodes] = useState<string[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  // ---- 作废确认对话框 ----
  const [revokeTarget, setRevokeTarget] = useState<AdminCodeItem | null>(null);
  const [revokeSubmitting, setRevokeSubmitting] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const copyText = useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }, []);

  async function handleCopyOne(code: string, idx: number) {
    const ok = await copyText(code);
    if (ok) {
      setCopiedIndex(idx);
      window.setTimeout(
        () => setCopiedIndex((cur) => (cur === idx ? null : cur)),
        1500,
      );
    }
  }

  async function handleCopyAll() {
    const ok = await copyText(resultCodes.join("\n"));
    if (ok) {
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1500);
    }
  }

  function openGenerate() {
    setGenCount(1);
    setGenDays(30);
    setGenNote("");
    setGenError(null);
    setGenOpen(true);
  }

  async function handleGenerate() {
    setGenSubmitting(true);
    setGenError(null);
    try {
      const res = await generateAdminCodes({
        count: genCount,
        duration_days: genDays,
        note: genNote.trim() ? genNote.trim() : undefined,
      });
      setResultCodes(res.codes);
      setCopiedIndex(null);
      setCopiedAll(false);
      setGenOpen(false);
      setResultOpen(true);
      startReload();
      setRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      setGenError(errorMessage(e, "生成兑换码失败"));
    } finally {
      setGenSubmitting(false);
    }
  }

  function openRevoke(code: AdminCodeItem) {
    setRevokeError(null);
    setRevokeTarget(code);
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevokeSubmitting(true);
    setRevokeError(null);
    try {
      await revokeAdminCode(revokeTarget.id);
      setRevokeTarget(null);
      startReload();
      setRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      setRevokeError(errorMessage(e, "作废兑换码失败"));
    } finally {
      setRevokeSubmitting(false);
    }
  }

  const hasPrev = offset > 0;
  const hasNext = items.length >= PAGE_SIZE;

  return (
    <AdminPage>
      <AdminPageHeader
        title="兑换码管理"
        description="生成、筛选与作废订阅兑换码，状态和使用记录集中查看。"
        actions={
          <Button className="rounded-full shadow-md shadow-primary/15" onClick={openGenerate}>
            <Plus />
            生成兑换码
          </Button>
        }
      />

      <div className="flex w-fit items-center gap-1 rounded-full border border-border/70 bg-card/75 p-1 shadow-sm shadow-foreground/5 backdrop-blur-xl">
        <Button
          size="sm"
          variant={filter === undefined ? "default" : "outline"}
          className="rounded-full border-transparent shadow-none"
          onClick={() => changeFilter(undefined)}
        >
          全部
        </Button>
        <Button
          size="sm"
          variant={filter === false ? "default" : "outline"}
          className="rounded-full border-transparent shadow-none"
          onClick={() => changeFilter(false)}
        >
          未使用
        </Button>
        <Button
          size="sm"
          variant={filter === true ? "default" : "outline"}
          className="rounded-full border-transparent shadow-none"
          onClick={() => changeFilter(true)}
        >
          已使用
        </Button>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-body text-muted-foreground">加载中…</div>
          ) : error ? (
            <div className="p-6 text-body text-destructive">{error}</div>
          ) : items.length === 0 ? (
            <div className="p-6 text-body text-muted-foreground">暂无兑换码</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">兑换码</TableHead>
                  <TableHead>时长</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>使用人</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead className="pr-5 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="break-all pl-5 font-mono text-fine">
                      {c.code}
                    </TableCell>
                    <TableCell>{c.duration_days}天</TableCell>
                    <TableCell>
                      {c.is_used ? (
                        <Badge variant="secondary">已用</Badge>
                      ) : (
                        <Badge>未用</Badge>
                      )}
                    </TableCell>
                    <TableCell>{c.used_by_user_id ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(c.created_at)}
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate">
                      {c.note ?? "—"}
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      {!c.is_used && (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="rounded-full"
                          onClick={() => openRevoke(c)}
                        >
                          <Trash2 />
                          作废
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <span className="text-body text-muted-foreground">
          {items.length > 0
            ? `第 ${offset + 1} - ${offset + items.length} 条`
            : "暂无数据"}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={!hasPrev || loading}
            onClick={goPrev}
          >
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={!hasNext || loading}
            onClick={goNext}
          >
            下一页
          </Button>
        </div>
      </div>

      {/* 生成兑换码 */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent className={ADMIN_DIALOG_CLASS}>
          <DialogHeader>
            <DialogTitle>生成兑换码</DialogTitle>
            <DialogDescription>
              批量生成兑换码，生成后明文仅展示一次，请提前准备好保存。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <label className="text-body font-medium" htmlFor="gen-count">
                数量（1-100）
              </label>
              <Input
                id="gen-count"
                type="number"
                min={1}
                max={100}
                value={genCount}
                onChange={(e) =>
                  setGenCount(
                    clampNumber(parseInt(e.target.value, 10), 1, 100),
                  )
                }
              />
            </div>
            <div className="grid gap-2">
              <label className="text-body font-medium" htmlFor="gen-days">
                时长天数（1-365）
              </label>
              <Input
                id="gen-days"
                type="number"
                min={1}
                max={365}
                value={genDays}
                onChange={(e) =>
                  setGenDays(
                    clampNumber(parseInt(e.target.value, 10), 1, 365),
                  )
                }
              />
            </div>
            <div className="grid gap-2">
              <label className="text-body font-medium" htmlFor="gen-note">
                备注（可选）
              </label>
              <Input
                id="gen-note"
                value={genNote}
                placeholder="例如：活动赠送"
                onChange={(e) => setGenNote(e.target.value)}
              />
            </div>
            {genError && <p className="text-body text-destructive">{genError}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGenOpen(false)}
              disabled={genSubmitting}
            >
              取消
            </Button>
            <Button onClick={handleGenerate} disabled={genSubmitting}>
              {genSubmitting ? "生成中…" : "确认生成"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 生成结果（明文仅一次）*/}
      <Dialog open={resultOpen} onOpenChange={setResultOpen}>
        <DialogContent className={`${ADMIN_DIALOG_CLASS} sm:max-w-lg`}>
          <DialogHeader>
            <DialogTitle>兑换码已生成</DialogTitle>
            <DialogDescription className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              请立即保存，关闭后无法再查看明文
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <span className="text-body text-muted-foreground">
              共 {resultCodes.length} 条
            </span>
            <Button size="sm" variant="outline" onClick={handleCopyAll}>
              {copiedAll ? <Check /> : <Copy />}
              {copiedAll ? "已复制" : "全部复制"}
            </Button>
          </div>
          <div className="max-h-80 overflow-auto rounded-panel border border-border/70 bg-muted/30 p-2">
            <ul className="space-y-1">
              {resultCodes.map((code, idx) => (
                <li
                  key={`${code}-${idx}`}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-muted"
                >
                  <code className="font-mono text-fine break-all">{code}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => handleCopyOne(code, idx)}
                  >
                    {copiedIndex === idx ? <Check /> : <Copy />}
                    {copiedIndex === idx ? "已复制" : "复制"}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button onClick={() => setResultOpen(false)}>我已保存，关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 作废确认 */}
      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(o) => {
          if (!o) setRevokeTarget(null);
        }}
      >
        <DialogContent className={ADMIN_DIALOG_CLASS}>
          <DialogHeader>
            <DialogTitle>作废兑换码</DialogTitle>
            <DialogDescription>
              确定要作废兑换码{" "}
              <code className="font-mono text-foreground">
                {revokeTarget?.code}
              </code>{" "}
              吗？作废后该码将无法再被使用。
            </DialogDescription>
          </DialogHeader>
          {revokeError && (
            <p className="text-body text-destructive">{revokeError}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRevokeTarget(null)}
              disabled={revokeSubmitting}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevoke}
              disabled={revokeSubmitting}
            >
              {revokeSubmitting ? "处理中…" : "确认作废"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  );
}
