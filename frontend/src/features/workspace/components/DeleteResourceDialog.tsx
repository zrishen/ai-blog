import { useState } from "react";

import { deleteBlogPost, listBlogPosts } from "@/api/blog";
import { deleteFileDocument } from "@/api/files";
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
import { useChat } from "../../../stores/chatStore";

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
          .then((result) => dispatch({ type: "SET_BLOG_POSTS", payload: result.posts }))
          .catch(() => {});
      } else {
        await deleteFileDocument(target.id);
        dispatch({ type: "INCREMENT_FILE_LIBRARY_REVISION" });
      }
      dispatch({ type: "INCREMENT_TRASH_REVISION" });
      onClose();
    } catch (error) {
      console.error("[workspace] 删除失败:", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
          <DialogDescription>确定要删除“{target?.name}”吗？删除后可在回收站恢复。</DialogDescription>
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
