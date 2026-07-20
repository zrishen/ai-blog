import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface MobileDrawerProps {
  open: boolean;
  side: "left" | "right";
  title: string;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export function MobileDrawer({
  open,
  side,
  title,
  onOpenChange,
  returnFocusRef,
  children,
}: MobileDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnFocusElement = returnFocusRef?.current;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      (returnFocusElement ?? previousActiveElement)?.focus();
    };
  }, [onOpenChange, open, returnFocusRef]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] md:hidden">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/35 backdrop-blur-[1px]"
        aria-label={`关闭${title}`}
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 flex w-[min(88vw,380px)] flex-col overflow-hidden bg-card shadow-2xl outline-none",
          side === "left" ? "left-0 border-r border-border" : "right-0 border-l border-border",
        )}
      >
        <div className="flex h-13 flex-shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full"
            aria-label={`关闭${title}`}
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
