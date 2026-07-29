/* resource 节点的共享操作逻辑（非组件部分）：重命名 / 移动 / 删除。
 *
 * 中栏 FolderView 与左栏 WorkspaceNav 复用同一份状态机，弹窗在 ResourceDialogs.tsx。
 * 重命名 = 改文件真实名（updateFileDocument）+ 同步挂靠节点名（patchNode）；
 * 移动 = moveResource 到目标文件夹，或 detachResource 移出工作区（未分类）；
 * 删除 = deleteFileDocument 软删进回收站（配合读时过滤，工作区立即隐藏）。
 */

import { useCallback, useState } from "react";

import { useChat } from "../../../stores/chatStore";
import type { WorkspaceNode } from "../../../api/client";
import { deleteFileDocument, updateFileDocument } from "../../../api/files";
import { deleteBlogPost, listBlogPosts, updateBlogPost } from "../../../api/blog";
import { detachResource, moveResource, patchNode } from "../../../api/workspace";

export interface RenameState {
  nodeId: number;
  resourceId: number;
  resourceType: "file" | "blog_post";
  value: string;
}

export interface MoveTargetState {
  node: WorkspaceNode;
  /** resource 当前所在文件夹（移动弹窗里禁选，避免原地不动） */
  currentFolderId: number | null;
}

export interface DeleteTargetState {
  node: WorkspaceNode;
  name: string;
}

export type ResourceActions = ReturnType<typeof useResourceActions>;

export function useResourceActions(reload: () => Promise<void>) {
  const { dispatch } = useChat();
  const [rename, setRename] = useState<RenameState | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTargetState | null>(null);
  // undefined=未选择; null=未分类(移出工作区); number=目标文件夹
  const [moveParentId, setMoveParentId] = useState<number | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTargetState | null>(null);
  const [busy, setBusy] = useState(false);

  const submitRename = useCallback(async () => {
    if (!rename) return;
    const name = rename.value.trim();
    const { nodeId, resourceId, resourceType } = rename;
    setRename(null);
    if (!name) return;
    try {
      setBusy(true);
      if (resourceType === "blog_post") {
        await updateBlogPost(resourceId, { title: name });
        // 同步博客列表缓存（草稿/已发布/工作台计数）
        listBlogPosts()
          .then((r) => dispatch({ type: "SET_BLOG_POSTS", payload: r.posts }))
          .catch(() => {});
      } else {
        await updateFileDocument(resourceId, name);
        dispatch({ type: "INCREMENT_FILE_LIBRARY_REVISION" });
      }
      // 工作区挂靠节点显示名同步
      await patchNode(nodeId, { name });
      await reload();
    } catch (e) {
      console.error("[workspace] 重命名失败:", e);
    } finally {
      setBusy(false);
    }
  }, [rename, reload, dispatch]);

  const submitMove = useCallback(async () => {
    if (!moveTarget || moveParentId === undefined) return;
    const { node } = moveTarget;
    const target = moveParentId;
    setMoveTarget(null);
    setMoveParentId(undefined);
    try {
      setBusy(true);
      if (target === null) {
        await detachResource(node.resource_type!, node.resource_id!);
      } else {
        await moveResource(node.resource_type!, node.resource_id!, target);
      }
      await reload();
      dispatch({ type: "INCREMENT_FILE_LIBRARY_REVISION" });
    } catch (e) {
      console.error("[workspace] 移动失败:", e);
    } finally {
      setBusy(false);
    }
  }, [moveTarget, moveParentId, reload, dispatch]);

  const submitDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const { node } = deleteTarget;
    const rid = node.resource_id;
    setDeleteTarget(null);
    if (rid == null) return;
    try {
      setBusy(true);
      if (node.resource_type === "blog_post") {
        await deleteBlogPost(rid);
        listBlogPosts()
          .then((r) => dispatch({ type: "SET_BLOG_POSTS", payload: r.posts }))
          .catch(() => {});
      } else {
        await deleteFileDocument(rid);
        dispatch({ type: "INCREMENT_FILE_LIBRARY_REVISION" });
      }
      await reload();
    } catch (e) {
      console.error("[workspace] 删除失败:", e);
    } finally {
      setBusy(false);
    }
  }, [deleteTarget, reload, dispatch]);

  return {
    rename,
    setRename,
    moveTarget,
    setMoveTarget,
    moveParentId,
    setMoveParentId,
    deleteTarget,
    setDeleteTarget,
    busy,
    submitRename,
    submitMove,
    submitDelete,
  };
}

/** 扁平化文件夹树（带 depth），供移动弹窗 Select 缩进展示目标文件夹。 */
export function flattenFolders(
  tree: WorkspaceNode[],
): { node: WorkspaceNode; depth: number }[] {
  const folders = tree.filter((n) => n.node_type === "folder");
  const byParent = new Map<number | null, WorkspaceNode[]>();
  for (const f of folders) {
    const arr = byParent.get(f.parent_id) ?? [];
    arr.push(f);
    byParent.set(f.parent_id, arr);
  }
  const result: { node: WorkspaceNode; depth: number }[] = [];
  const walk = (parentId: number | null, depth: number) => {
    const children = (byParent.get(parentId) ?? []).sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    for (const c of children) {
      result.push({ node: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}
