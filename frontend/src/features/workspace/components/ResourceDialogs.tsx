/* resource 操作的共享弹窗：移动 / 删除。挂在持有 useResourceActions 的组件根部。 */

import type { WorkspaceNode } from "@/api/workspace";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ResourceActions } from "./resourceActions";

export function ResourceDialogs({
  actions,
  flatFolders,
}: {
  actions: ResourceActions;
  flatFolders: { node: WorkspaceNode; depth: number }[];
}) {
  const {
    moveTarget,
    setMoveTarget,
    moveParentId,
    setMoveParentId,
    deleteTarget,
    setDeleteTarget,
    busy,
    submitMove,
    submitDelete,
  } = actions;

  return (
    <>
      <Dialog
        open={moveTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMoveTarget(null);
            setMoveParentId(undefined);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移动「{moveTarget?.node.name}」</DialogTitle>
            <DialogDescription>
              选择目标文件夹，或移出工作区（回到「未分类」）。
            </DialogDescription>
          </DialogHeader>
          <Select
            className="h-10"
            value={
              moveParentId === undefined
                ? ""
                : moveParentId === null
                  ? "inbox"
                  : String(moveParentId)
            }
            onChange={(e) => {
              const v = e.target.value;
              setMoveParentId(v === "" ? undefined : v === "inbox" ? null : Number(v));
            }}
          >
            <option value="">选择目标…</option>
            <option value="inbox">未分类（移出工作区）</option>
            {flatFolders.map(({ node, depth }) => (
              <option
                key={node.id}
                value={node.id}
                disabled={node.id === moveTarget?.currentFolderId}
              >
                {"　".repeat(depth)}
                {node.name}
              </option>
            ))}
          </Select>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={submitMove} disabled={moveParentId === undefined || busy}>
              移动
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteTarget?.name}」吗？删除后可在回收站恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={submitDelete} disabled={busy}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
