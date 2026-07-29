import { useEffect, useMemo, useState } from "react";
import { Archive, FileStack, FileText, Inbox } from "lucide-react";
import {
  listBlogPosts,
  listFileDocuments,
  type BlogPostData,
  type FileDocument,
} from "../../../api/client";
import { useChat } from "../../../stores/chatStore";
import { EmptyState } from "@/components/ui/empty-state";
import { ArchiveToFolderDialog, type ArchiveTarget } from "../components/ArchiveToFolderDialog";
import { LoadingState, SectionCard, WorkspaceView } from "./shared";
import { formatDate } from "./utils";

// 未分类：未挂靠到任何工作区文件夹的文件与文章（文章段在上、文件段在下）。
export function UnarchivedView({
  onOpenFile,
  onOpenBlog,
}: {
  onOpenFile: (filePath: string) => void;
  onOpenBlog: (id: number) => void;
}) {
  const { state } = useChat();
  const [docs, setDocs] = useState<FileDocument[] | null>(null);
  const [posts, setPosts] = useState<BlogPostData[] | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);

  useEffect(() => {
    let alive = true;
    listFileDocuments()
      .then((r) => {
        if (alive) setDocs(r.documents);
      })
      .catch(() => {
        if (alive) setDocs([]);
      });
    return () => {
      alive = false;
    };
  }, [state.fileLibraryRevision]);

  useEffect(() => {
    let alive = true;
    listBlogPosts()
      .then((r) => {
        if (alive) setPosts(r.posts);
      })
      .catch(() => {
        if (alive) setPosts([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 已挂靠到工作区文件夹的资源 id（resource 节点的 resource_id），按类型分桶
  const attachedFileIds = useMemo(
    () =>
      new Set(
        state.workspaceTree
          .filter((n) => n.node_type === "resource" && n.resource_type === "file" && n.resource_id != null)
          .map((n) => n.resource_id as number),
      ),
    [state.workspaceTree],
  );
  const attachedPostIds = useMemo(
    () =>
      new Set(
        state.workspaceTree
          .filter(
            (n) => n.node_type === "resource" && n.resource_type === "blog_post" && n.resource_id != null,
          )
          .map((n) => n.resource_id as number),
      ),
    [state.workspaceTree],
  );

  const files = useMemo(
    () => (docs === null ? null : docs.filter((d) => !attachedFileIds.has(d.id))),
    [docs, attachedFileIds],
  );
  const unarchivedPosts = useMemo(
    () => (posts === null ? null : posts.filter((p) => !attachedPostIds.has(p.id))),
    [posts, attachedPostIds],
  );

  const loading = files === null || unarchivedPosts === null;
  const total = (files?.length ?? 0) + (unarchivedPosts?.length ?? 0);

  return (
    <WorkspaceView>
      <div className="flex flex-col flex-1 min-h-0 gap-3">
        {loading ? (
          <LoadingState />
        ) : total === 0 ? (
          <EmptyState
            icon={Inbox}
            title="没有未分类的内容"
            description="所有文件和文章都已归入文件夹。"
            className="flex-1 p-10"
          />
        ) : (
          <>
            {unarchivedPosts!.length > 0 && (
              <SectionCard title={`文章 · ${unarchivedPosts!.length}`} icon={FileText}>
                <ul className="flex flex-col">
                  {unarchivedPosts!.map((p) => (
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
                        onClick={() => onOpenBlog(p.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onOpenBlog(p.id);
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
            {files!.length > 0 && (
              <SectionCard title={`文件 · ${files!.length}`} icon={FileStack}>
                <ul className="flex flex-col">
                  {files!.map((d) => (
                    <li key={d.id} className="group relative">
                      <div
                        role="button"
                        tabIndex={0}
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation();
                          e.dataTransfer.setData("text/plain", `file:${d.id}`);
                          e.dataTransfer.setData("application/x-ws-name", d.original_name);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={() => onOpenFile(d.file_path)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onOpenFile(d.file_path);
                          }
                        }}
                        className="flex w-full cursor-pointer select-none items-center gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-secondary/60"
                        title={d.original_name}
                      >
                        <FileStack className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
                          {d.original_name}
                        </span>
                        <span className="text-fine text-muted-foreground">
                          {d.chunk_count} 片段 · {formatDate(d.created_at)}
                        </span>
                      </div>
                      <button
                        type="button"
                        aria-label="归档到文件夹"
                        onClick={(e) => {
                          e.stopPropagation();
                          setArchiveTarget({ type: "file", id: d.id, name: d.original_name });
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
          </>
        )}
      </div>
      <ArchiveToFolderDialog
        open={archiveTarget !== null}
        target={archiveTarget}
        onClose={() => setArchiveTarget(null)}
      />
    </WorkspaceView>
  );
}
