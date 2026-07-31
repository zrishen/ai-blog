/* 资源删除确认弹窗：软删 file/blog 进回收站，配合读时过滤让列表立即隐藏。
 * 供未分类 / 草稿 / 已发布等「裸资源」视图复用（FolderView 的 node 删除仍走 useResourceActions）。 */

import { useState } from "react";

import { useChat } from "../../../stores/chatStore";
import { deleteFileDocument } from "../../../api/files";
import { deleteBlogPost, listBlogPosts } from "../../../api/blog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface DeleteResourceTarget {
  type: "file" | "blog_post";
  id: number;
  name: string;
}

export function DeleteResourceDialog({
  target,
  onClose,
}: {
  target: DeleteResourceTarget | null;
  onClose: () => void;
}) {
  const { dispatch } = useChat();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!target) return;
    try {
      setBusy(true);
      if (target.type === "blog_post") {
        await deleteBlogPost(target.id);
        listBlogPosts()
          .then((r) => dispatch({ type: "SET_BLOG_POSTS", payload: r.posts }))
          .catch(() => {});
      } else {
        await deleteFileDocument(target.id);
        dispatch({ type: "INCREMENT_FILE_LIBRARY_REVISION" });
      }
      dispatch({ type: "INCREMENT_TRASH_REVISION" });
      onClose();
    } catch (e) {
      console.error("[workspace] 删除失败:", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
          <DialogDescription>
            确定要删除「{target?.name}」吗？删除后可在回收站恢复。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">取消</Button>
          </DialogClose>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
