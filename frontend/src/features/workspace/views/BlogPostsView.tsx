import { useEffect, useMemo, useState } from "react";
import { Archive, FileText, Plus, Trash2 } from "lucide-react";
import { listBlogPosts } from "@/api/blog";
import type { BlogPostData } from "@/api/blog";
import { useChat } from "../../../stores/chatStore";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BlogIcon, PublishedIcon } from "@/components/icons";
import { ArchiveToFolderDialog, type ArchiveTarget } from "../components/ArchiveToFolderDialog";
import { DeleteResourceDialog, type DeleteResourceTarget } from "../components/DeleteResourceDialog";
import { LoadingState, SectionCard, WorkspaceView } from "./shared";
import { formatDate } from "./utils";

export function BlogPostsView({
  status,
  title,
  onOpen,
  onCreate,
}: {
  status: "draft" | "published";
  title: string;
  onOpen: (id: number) => void;
  onCreate: () => void;
}) {
  const { state } = useChat();
  const [posts, setPosts] = useState<BlogPostData[] | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteResourceTarget | null>(null);

  useEffect(() => {
    let alive = true;
    listBlogPosts({ status })
      .then((r) => {
        if (alive) setPosts(r.posts);
      })
      .catch(() => {
        if (alive) setPosts([]);
      });
    return () => {
      alive = false;
    };
  }, [status, state.trashRevision]);

  // 文章 id → 归档所在文件夹名（未归档则不在 map）。草稿/已发布视图按状态列出全部文章，
  // 已归档的标注其文件夹——避免「还是草稿却在草稿视图找不到」的困惑（与文件夹视图正交）。
  const postFolderName = useMemo(() => {
    const folderName = new Map<number, string>();
    for (const n of state.workspaceTree) {
      if (n.node_type === "folder") folderName.set(n.id, n.name);
    }
    const map = new Map<number, string>();
    for (const n of state.workspaceTree) {
      if (
        n.node_type === "resource" &&
        n.resource_type === "blog_post" &&
        n.resource_id != null &&
        n.parent_id != null
      ) {
        const name = folderName.get(n.parent_id);
        if (name) map.set(n.resource_id, name);
      }
    }
    return map;
  }, [state.workspaceTree]);

  const PostIcon = status === "published" ? PublishedIcon : BlogIcon;

  return (
    <WorkspaceView>
      <SectionCard
        title={`${title} · ${posts?.length ?? 0}`}
        icon={FileText}
        actions={
          <Button size="sm" variant="ghost" onClick={onCreate}>
            <Plus className="h-3.5 w-3.5" />
            新建文章
          </Button>
        }
      >
        {posts === null ? (
          <LoadingState />
        ) : posts.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={`暂无${title}`}
            description={status === "draft" ? "新建一篇草稿开始创作。" : "还没有发布过文章。"}
            className="flex-1 p-10"
          />
        ) : (
          <ul className="flex flex-col">
            {posts.map((p) => (
              <li key={p.id} className="group relative">
                <div
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    e.dataTransfer.setData("text/plain", `blog:${p.id}`);
                    e.dataTransfer.setData("application/x-ws-name", p.title || "无标题");
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => onOpen(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(p.id);
                    }
                  }}
                  className="flex w-full cursor-pointer select-none items-center gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-secondary/60"
                >
                  <PostIcon className="h-4 w-4 flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
                    {p.title || "无标题"}
                  </span>
                  {postFolderName.has(p.id) && (
                    <Badge variant="secondary" className="max-w-[8rem] truncate">
                      {postFolderName.get(p.id)}
                    </Badge>
                  )}
                  <span className="text-fine text-muted-foreground transition-opacity group-hover:opacity-0">
                    {formatDate(p.updated_at ?? p.created_at)}
                  </span>
                </div>
                {/* hover「归档 / 删除」按钮：拖拽的兜底入口（移动端 / 精确选） */}
                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label="归档到文件夹"
                    onClick={(e) => {
                      e.stopPropagation();
                      setArchiveTarget({ type: "blog_post", id: p.id, name: p.title || "无标题" });
                    }}
                    className="flex items-center gap-1 rounded-control bg-card/80 px-1.5 py-1 text-fine text-muted-foreground backdrop-blur-sm transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    归档
                  </button>
                  <button
                    type="button"
                    aria-label="删除"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget({ type: "blog_post", id: p.id, name: p.title || "无标题" });
                    }}
                    className="flex items-center gap-1 rounded-control bg-card/80 px-1.5 py-1 text-fine text-muted-foreground backdrop-blur-sm transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <ArchiveToFolderDialog
        open={archiveTarget !== null}
        target={archiveTarget}
        onClose={() => setArchiveTarget(null)}
      />
      <DeleteResourceDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </WorkspaceView>
  );
}
