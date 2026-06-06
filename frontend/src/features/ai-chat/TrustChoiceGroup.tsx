import { Button } from "@/components/ui/button";
import type { TrustChoiceOption } from "./trustPrompts";

interface TrustChoiceGroupProps {
  options: TrustChoiceOption[];
  disabled?: boolean;
  onSelect: (option: TrustChoiceOption) => void;
}

export function TrustChoiceGroup({ options, disabled = false, onSelect }: TrustChoiceGroupProps) {
  if (options.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border/50 pt-2.5">
      <div className="mb-2 text-[11px] font-semibold text-muted-foreground">请选择下一步：</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <Button
            key={option.id}
            type="button"
            variant={option.kind === "action" && option.action === "dismiss" ? "ghost" : "outline"}
            size="sm"
            className="h-7 rounded-full px-2.5 text-[11px]"
            disabled={disabled}
            onClick={() => onSelect(option)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
