import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface MobileDrawerProps {
  open: boolean;
  side: "left" | "right";
  title: string;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  // 是否允许本抽屉响应边缘滑动。另一侧抽屉打开时，本侧（关闭态）应失效，避免被误滑出/误切换。
  swipeEnabled?: boolean;
  children: ReactNode;
}

// 起点距屏幕边缘 <= 此值才进入本侧抽屉的拖拽（避开中栏横向滚动与内容纵向滚动）。
// 偏宽以便起手：轻点(tap)位移小不会触发手势，故加宽不影响卡片点击。
const EDGE_BAND = 38;
// 松手后判定切换的位移阈值：面板被拖过自身宽度的此比例即吸附到另一态。
const SWIPE_FRACTION = 0.5;
const DURATION = 0.3;

/**
 * 移动端抽屉：始终挂载（面板用 translate 在屏内/屏外切换），支持跟随手指的边缘滑动。
 * - 无抽屉打开：从左/右屏幕边缘向内拖，面板实时贴合滑入，松手过半即吸附全开，否则回弹。
 * - 抽屉打开：向屏外方向拖可推回关闭，松手过半即关闭，否则回弹。
 * 仅当水平分量明显大于垂直分量时接管触摸，否则让出给页面滚动。
 */
export function MobileDrawer({
  open,
  side,
  title,
  onOpenChange,
  returnFocusRef,
  swipeEnabled = true,
  children,
}: MobileDrawerProps) {
  const isLeft = side === "left";
  const panelRef = useRef<HTMLDivElement>(null);
  // 面板宽度（像素），用于把 translate 换算成屏外位移。min(88vw,380px) 随视口变化，需实测。
  const widthRef = useRef(380);
  // 经 ref 保持最新引用：避免不稳定回调进 effect 依赖，打字触发父级重渲染时不重跑焦点 effect 抢焦点。
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });
  const swipeEnabledRef = useRef(swipeEnabled);
  useEffect(() => {
    swipeEnabledRef.current = swipeEnabled;
  });

  const hiddenX = useCallback(() => (isLeft ? -widthRef.current : widthRef.current), [isLeft]);

  // 面板水平位移（像素）：0 = 全开，±width = 屏外。
  const x = useMotionValue(0);

  // 首帧定位（paint 前同步）：测宽 + 落到当前态，避免首屏闪现在屏内。
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (el) widthRef.current = el.offsetWidth || 380;
    x.set(open ? 0 : hiddenX());
    // 仅首帧定位：依赖故意留空只跑一次，避免 open 变化时与下面的吸附 effect 抢着 set x。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 视口变化导致面板宽度变化 → 重测；关闭态同步收回新的屏外位，避免宽度变了留残影。
  useEffect(() => {
    const onResize = () => {
      const el = panelRef.current;
      if (!el) return;
      widthRef.current = el.offsetWidth || 380;
      if (!open) x.set(hiddenX());
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, x, isLeft, hiddenX]);

  // open 被外部切换（按钮/遮罩/Escape/手势触达阈值）→ 补间吸附到目标位。
  useEffect(() => {
    const controls = animate(x, open ? 0 : hiddenX(), {
      type: "tween",
      duration: DURATION,
      ease: "easeOut",
    });
    return () => controls.stop();
  }, [open, x, isLeft, hiddenX]);

  // 遮罩透明度随面板可见比例联动（拖动时同步淡入/淡出）。
  const overlayOpacity = useTransform(x, (value) => {
    const w = widthRef.current || 380;
    const visible = isLeft ? (value + w) / w : (w - value) / w;
    return Math.min(1, Math.max(0, visible));
  });

  // 焦点 / Escape / body 滚动锁定（仅打开态）。
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnFocusElement = returnFocusRef?.current;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChangeRef.current(false);
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      (returnFocusElement ?? previousActiveElement)?.focus();
    };
  }, [open, returnFocusRef]);

  // 跟随手指手势：仅本侧屏幕边缘起始才接管，否则不干预（留给页面滚动）。
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let lockedHorizontal = false;

    const onTouchStart = (event: TouchEvent) => {
      if (!swipeEnabledRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;
      const w = widthRef.current || 380;
      // 关闭态：仅本侧屏幕边缘起始才拖出（避开中栏滚动）；
      // 打开态：面板已盖住边缘，改为面板内任意位置起始可拖回（仅水平拖动接管，不碍纵向滚动）。
      const canStart = open
        ? isLeft
          ? touch.clientX <= w
          : touch.clientX >= window.innerWidth - w
        : isLeft
          ? touch.clientX <= EDGE_BAND
          : touch.clientX >= window.innerWidth - EDGE_BAND;
      if (!canStart) return;
      startX = touch.clientX;
      startY = touch.clientY;
      dragging = true;
      lockedHorizontal = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!dragging) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!lockedHorizontal) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        // 纵向为主 → 让出给页面滚动，放弃本次拖拽。
        if (Math.abs(dy) > Math.abs(dx) * 1.5) {
          dragging = false;
          return;
        }
        lockedHorizontal = true;
      }
      event.preventDefault();
      const w = widthRef.current || 380;
      // 打开态从 0 向屏外推；关闭态从屏外向 0 拉。均限制在 [-w, 0] 或 [0, w]。
      const next = open
        ? isLeft
          ? Math.min(0, Math.max(-w, dx))
          : Math.max(0, Math.min(w, dx))
        : isLeft
          ? Math.max(-w, Math.min(0, -w + dx))
          : Math.min(w, Math.max(0, w + dx));
      x.set(next);
    };

    const onTouchEnd = () => {
      if (!dragging || !lockedHorizontal) {
        dragging = false;
        return;
      }
      dragging = false;
      const w = widthRef.current || 380;
      const current = x.get();
      // pastOpen=true 表示面板更靠近"全开(0)"。
      const pastOpen = isLeft ? current > -w * SWIPE_FRACTION : current < w * SWIPE_FRACTION;
      if (open) {
        // 推出过半 → 关闭（交由 open-effect 吸附）；否则回弹全开。
        if (!pastOpen) onOpenChangeRef.current(false);
        else animate(x, 0, { duration: DURATION, ease: "easeOut" });
      } else {
        // 拉入过半 → 打开；否则回弹收回。
        if (pastOpen) onOpenChangeRef.current(true);
        else animate(x, hiddenX(), { duration: DURATION, ease: "easeOut" });
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [open, x, isLeft, hiddenX]);

  return (
    <div className={cn("fixed inset-0 z-[120] md:hidden", !open && "pointer-events-none")}>
      <motion.button
        type="button"
        style={{ opacity: overlayOpacity }}
        className="absolute inset-0 cursor-default bg-foreground/35 backdrop-blur-[1px]"
        aria-label={`关闭${title}`}
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        onClick={() => onOpenChangeRef.current(false)}
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-hidden={!open}
        tabIndex={-1}
        style={{ x }}
        className={cn(
          "absolute inset-y-0 flex w-[min(88vw,380px)] flex-col overflow-hidden bg-card shadow-2xl outline-none",
          isLeft ? "left-0 border-r border-border" : "right-0 border-l border-border",
        )}
      >
        <div className="flex h-13 flex-shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="text-body font-semibold text-foreground">{title}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full"
            aria-label={`关闭${title}`}
            onClick={() => onOpenChangeRef.current(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </motion.div>
    </div>
  );
}
