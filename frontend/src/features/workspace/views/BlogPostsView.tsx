import { useEffect, useState } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";

import { listBlogPosts } from "@/api/blog";
import type { BlogPostData } from "@/api/blog";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { BlogIcon, PublishedIcon } from "@/components/icons";
import { useChat } from "../../../stores/chatStore";
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
  const [deleteTarget, setDeleteTarget] = useState<DeleteResourceTarget | null>(null);

  useEffect(() => {
    let alive = true;
    listBlogPosts({ status })
      .then((result) => {
        if (alive) setPosts(result.posts);
      })
      .catch(() => {
        if (alive) setPosts([]);
      });
    return () => {
      alive = false;
    };
  }, [status, state.trashRevision]);

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
            {posts.map((post) => (
              <li key={post.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onOpen(post.id)}
                  className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-secondary/60"
                >
                  <PostIcon className="h-4 w-4 flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
                    {post.title || "无标题"}
                  </span>
                  <span className="text-fine text-muted-foreground transition-opacity group-hover:opacity-0">
                    {formatDate(post.updated_at ?? post.created_at)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="删除"
                  onClick={() => setDeleteTarget({ type: "blog_post", id: post.id, name: post.title || "无标题" })}
                  className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-control bg-card/80 px-1.5 py-1 text-fine text-muted-foreground opacity-0 backdrop-blur-sm transition-colors group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <DeleteResourceDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </WorkspaceView>
  );
}
