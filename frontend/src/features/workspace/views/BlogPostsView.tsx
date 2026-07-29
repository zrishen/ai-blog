import { useEffect, useState } from "react";
import { Archive, FileText } from "lucide-react";
import { listBlogPosts, type BlogPostData } from "../../../api/client";
import { EmptyState } from "@/components/ui/empty-state";
import { ArchiveToFolderDialog, type ArchiveTarget } from "../components/ArchiveToFolderDialog";
import { LoadingState, SectionCard, WorkspaceView } from "./shared";
import { formatDate } from "./utils";

export function BlogPostsView({
  status,
  title,
  onOpen,
}: {
  status: "draft" | "published";
  title: string;
  onOpen: (id: number) => void;
}) {
  const [posts, setPosts] = useState<BlogPostData[] | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);

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
  }, [status]);

  return (
    <WorkspaceView>
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
        <SectionCard title={`${title} · ${posts.length}`} icon={FileText}>
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
                  <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
                    {p.title || "无标题"}
                  </span>
                  <span className="text-fine text-muted-foreground">
                    {formatDate(p.updated_at ?? p.created_at)}
                  </span>
                </div>
                {/* hover「归档」按钮：拖拽的兜底入口（移动端 / 精确选） */}
                <button
                  type="button"
                  aria-label="归档到文件夹"
                  onClick={(e) => {
                    e.stopPropagation();
                    setArchiveTarget({ type: "blog_post", id: p.id, name: p.title || "无标题" });
                  }}
                  className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-control bg-card/80 px-1.5 py-1 text-fine text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                >
                  <Archive className="h-3.5 w-3.5" />
                  归档
                </button>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
      <ArchiveToFolderDialog
        open={archiveTarget !== null}
        target={archiveTarget}
        onClose={() => setArchiveTarget(null)}
      />
    </WorkspaceView>
  );
}
