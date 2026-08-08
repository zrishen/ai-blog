import { useMemo, useState } from "react";
import { Folder } from "lucide-react";
import { attachResource, getWorkspaceTree } from "@/api/workspace";
import { useChat } from "../../../stores/chatStore";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { buildTree, flattenFolders } from "../views/utils";

export interface ArchiveTarget {
  type: "blog_post" | "file";
  id: number;
  name: string;
}

/**
 * 归档到文件夹：拖拽的兜底入口（移动端 / 精确选）。
 * 展示当前文件夹树，选中后 attachResource 把资源挂靠进去。
 */
export function ArchiveToFolderDialog({
  open,
  onClose,
  target,
}: {
  open: boolean;
  onClose: () => void;
  target: ArchiveTarget | null;
}) {
  const { state, dispatch } = useChat();
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const flat = useMemo(
    () => flattenFolders(buildTree(state.workspaceTree)),
    [state.workspaceTree],
  );

  const confirm = async () => {
    if (!target || selected == null) return;
    setBusy(true);
    try {
      await attachResource(target.type, target.id, selected, target.name);
      const nodes = await getWorkspaceTree();
      dispatch({ type: "SET_WORKSPACE_TREE", payload: nodes });
      dispatch({ type: "INCREMENT_FILE_LIBRARY_REVISION" });
      onClose();
    } catch (e) {
      console.error("[workspace] 归档失败:", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSelected(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-[420px] gap-0 p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-body-lg">归档到文件夹</DialogTitle>
          <DialogDescription className="text-meta">
            选择目标文件夹{target ? `，将「${target.name}」收纳进去` : ""}。
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto p-2">
          {flat.length === 0 ? (
            <p className="px-2 py-6 text-center text-body text-muted-foreground">
              还没有文件夹，先在左侧栏右键新建一个。
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {flat.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelected(f.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-control py-1.5 pr-2 text-left text-body transition-colors",
                    selected === f.id
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-accent",
                  )}
                  style={{ paddingLeft: f.depth * 14 + 8 }}
                >
                  <Folder
                    className={cn(
                      "h-4 w-4 flex-shrink-0",
                      selected === f.id ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="border-t border-border px-4 py-3">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={confirm} disabled={selected == null || busy}>
            {busy ? "归档中…" : "归档"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
