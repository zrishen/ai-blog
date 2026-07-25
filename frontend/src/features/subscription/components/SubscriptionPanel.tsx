import { useEffect, useState } from "react";
import {
  getSubscriptionStatus,
  redeemSubscriptionCode,
  type SubscriptionStatus,
} from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { surfaceVariants } from "@/lib/visualVariants";

// 周额度展示用 M 单位（÷1e6 保留 1 位）。
const fmtM = (n: number): string => (n / 1e6).toFixed(1);

/** 订阅状态面板：订阅有效期 + 本周 token 配额进度条（Codex 风）+ 兑换码激活。
 *  嵌在 NavBar 的设置 Dialog 内，自包含拉取/兑换逻辑。 */
export function SubscriptionPanel() {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSubscriptionStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRedeem() {
    const c = code.trim();
    if (!c) return;
    setSubmitting(true);
    setMsg(null);
    try {
      const s = await redeemSubscriptionCode(c);
      setStatus(s);
      setCode("");
      setMsg({
        kind: "ok",
        text: `兑换成功，订阅有效期至 ${new Date(s.expires_at ?? "").toLocaleString()}`,
      });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "兑换失败" });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className={cn(surfaceVariants({ variant: "inset" }), "px-4 py-3 text-[13px] text-muted-foreground")}>
        订阅状态加载中…
      </div>
    );
  }
  if (error) {
    return (
      <div className={cn(surfaceVariants({ variant: "inset" }), "border-destructive/20 bg-destructive/8 px-4 py-3 text-[13px] text-destructive")}>
        {error}
      </div>
    );
  }
  if (!status) return null;

  const pct = status.limit > 0 ? (status.used / status.limit) * 100 : 0;
  const overWarn = pct > 80;

  return (
    <section
      data-testid="subscription-status-surface"
      className={cn(surfaceVariants({ variant: "inset" }), "space-y-4 p-4")}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">订阅</span>
        <Badge variant={status.active ? "default" : "secondary"}>
          {status.active ? "订阅生效" : "未订阅 / 已过期"}
        </Badge>
      </div>

      <div className="text-[13px] text-muted-foreground">
        {status.expires_at
          ? `有效期至 ${new Date(status.expires_at).toLocaleString()}`
          : "暂无有效订阅，可在下方输入兑换码激活"}
      </div>

      {/* 本周 token 配额进度条 */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-foreground">本周用量</span>
          <span>
            <span className="font-semibold text-foreground">{fmtM(status.used)}M</span>
            <span className="text-muted-foreground"> / {fmtM(status.limit)}M</span>
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted/75">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              overWarn ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            剩余 {fmtM(status.remaining)}M
            {status.period ? ` · 周期 ${status.period}` : ""}
          </span>
          <span className={overWarn ? "font-medium text-destructive" : ""}>
            占比 {pct.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* 兑换码激活 */}
      <div className="space-y-2 border-t border-border/60 pt-3.5">
        <span className="text-sm font-medium text-foreground">兑换码</span>
        <div className="flex gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="输入兑换码"
            disabled={submitting}
            className="h-10 rounded-control border-border/70 bg-background/70 shadow-sm"
          />
          <Button
            className="h-10 rounded-control px-4 shadow-sm shadow-primary/10"
            onClick={handleRedeem}
            disabled={submitting || !code.trim()}
          >
            {submitting ? "兑换中…" : "兑换"}
          </Button>
        </div>
        {msg && (
          <div
            className={cn(
              "text-[13px]",
              msg.kind === "ok" ? "text-emerald-600" : "text-destructive",
            )}
          >
            {msg.text}
          </div>
        )}
      </div>
    </section>
  );
}
