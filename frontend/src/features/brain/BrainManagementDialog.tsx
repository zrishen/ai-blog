import { Loader2 } from "lucide-react";
import type { FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BrainFact, BrainMemoryType, BrainPreference } from "@/api/brain";

export type BrainManagementAction =
  | { kind: "correct-fact"; fact: BrainFact }
  | { kind: "update-preference"; preference: BrainPreference }
  | { kind: "delete-memory"; memoryType: BrainMemoryType; memoryId: string; label: string };

export function BrainManagementDialog({
  action,
  pending,
  error,
  onOpenChange,
  onCorrectFact,
  onUpdatePreference,
  onDeleteMemory,
}: {
  action: BrainManagementAction | null;
  pending: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onCorrectFact: (fact: BrainFact, objectText: string) => Promise<void>;
  onUpdatePreference: (preference: BrainPreference, value: string) => Promise<void>;
  onDeleteMemory: (memoryType: BrainMemoryType, memoryId: string) => Promise<void>;
}) {
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!action) return;
    const value = String(new FormData(event.currentTarget).get("value") ?? "").trim();
    if (action.kind === "correct-fact") {
      await onCorrectFact(action.fact, value);
    } else if (action.kind === "update-preference") {
      await onUpdatePreference(action.preference, value);
    } else {
      await onDeleteMemory(action.memoryType, action.memoryId);
    }
  };

  const isDelete = action?.kind === "delete-memory";
  const title = isDelete ? "确认删除记忆" : action?.kind === "correct-fact" ? "纠正事实" : "更新偏好";
  const description = isDelete
    ? `将永久删除「${action?.label ?? ""}」及其图关系，此操作不可撤销。`
    : action?.kind === "correct-fact"
      ? "新事实会替代当前记录，旧事实将保留为历史版本。"
      : "新偏好会替代当前记录，历史值保留用于追溯。";
  const value = action?.kind === "correct-fact"
    ? action.fact.object_text
    : action?.kind === "update-preference"
      ? action.preference.value
      : "";
  const fieldLabel = action?.kind === "correct-fact" ? "新的事实值" : "偏好内容";

  return (
    <Dialog open={action !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {!isDelete && (
            <div className="mt-5 grid gap-2">
              <Label htmlFor="brain-management-value">{fieldLabel}</Label>
              <Textarea
                key={action?.kind === "correct-fact" ? action.fact.fact_id : action?.kind === "update-preference" ? action.preference.pref_id : ""}
                id="brain-management-value"
                name="value"
                defaultValue={value}
                required
                maxLength={2000}
              />
            </div>
          )}
          {error && <Alert variant="destructive" className="mt-4 text-meta">{error}</Alert>}
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" className="rounded-control" onClick={() => onOpenChange(false)} disabled={pending}>
              取消
            </Button>
            <Button type="submit" variant={isDelete ? "destructive" : "default"} className="rounded-control" disabled={pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isDelete ? "删除" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
