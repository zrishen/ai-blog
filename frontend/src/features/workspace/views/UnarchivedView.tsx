import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { Archive, Inbox, Plus, Trash2, Upload } from "lucide-react";
import { BlogIcon, PublishedIcon } from "@/components/icons";
import { getFileIcon } from "@/components/fileIcons";
import { listBlogPosts } from "@/api/blog";
import type { BlogPostData } from "@/api/blog";
import { listFileDocuments } from "@/api/files";
import type { FileDocument } from "@/api/files";
import { useChat } from "../../../stores/chatStore";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArchiveToFolderDialog, type ArchiveTarget } from "../components/ArchiveToFolderDialog";
import { DeleteResourceDialog, type DeleteResourceTarget } from "../components/DeleteResourceDialog";
import { useFileProcessing } from "@/lib/providers/FileProcessingProvider";
import { LoadingState, SectionCard, WorkspaceView } from "./shared";
import { formatDate } from "./utils";

// 未分类：未挂靠到任何工作区文件夹的文件与文章，按时间倒序混排（不再分「文章 / 文件」两段）。

interface InboxRow {
  key: string;
  icon: ReactNode;
  name: string;
  meta: string;
  dragData: string;
  dragName: string;
  onOpen: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

// 文章与文件共用的未分类行：图标 + 名称 + 右侧元信息，hover 露出「归档 / 删除」兜底入口。
function InboxRowItem({
  icon,
  name,
  meta,
  dragData,
  dragName,
  onOpen,
  onArchive,
  onDelete,
}: InboxRow) {
  return (
    <li className="group relative">
      <div
        role="button"
        tabIndex={0}
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData("text/plain", dragData);
          e.dataTransfer.setData("application/x-ws-name", dragName);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="flex w-full cursor-pointer select-none items-center gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-secondary/60"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">{name}</span>
        {/* hover 时淡出，让位给「归档」按钮，避免叠在元信息上 */}
        <span className="text-fine text-muted-foreground transition-opacity group-hover:opacity-0">{meta}</span>
      </div>
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          aria-label="归档到文件夹"
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
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
            onDelete();
          }}
          className="flex items-center gap-1 rounded-control bg-card/80 px-1.5 py-1 text-fine text-muted-foreground backdrop-blur-sm transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </button>
      </div>
    </li>
  );
}

export function UnarchivedView({
  onOpenFile,
  onOpenBlog,
  onCreateBlog,
}: {
  onOpenFile: (filePath: string) => void;
  onOpenBlog: (id: number) => void;
  onCreateBlog: () => void;
}) {
  const { state } = useChat();
  const { startUpload } = useFileProcessing();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<FileDocument[] | null>(null);
  const [posts, setPosts] = useState<BlogPostData[] | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteResourceTarget | null>(null);

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
  }, [state.trashRevision]);

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

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    for (const file of files) await startUpload(file);
  };

  const rows = useMemo<InboxRow[]>(() => {
    if (loading) return [];
    type WithTs = InboxRow & { ts: number };
    const postRows: WithTs[] = (unarchivedPosts ?? []).map((p) => {
      const name = p.title || "无标题";
      const ts = p.updated_at ?? p.created_at;
      return {
        key: `post-${p.id}`,
        icon:
          p.status === "published" ? (
            <PublishedIcon className="h-4 w-4 flex-shrink-0" />
          ) : (
            <BlogIcon className="h-4 w-4 flex-shrink-0" />
          ),
        name,
        meta: formatDate(ts),
        dragData: `blog:${p.id}`,
        dragName: name,
        onOpen: () => onOpenBlog(p.id),
        onArchive: () => setArchiveTarget({ type: "blog_post", id: p.id, name }),
        onDelete: () => setDeleteTarget({ type: "blog_post", id: p.id, name }),
        ts: Date.parse(ts) || 0,
      };
    });
    const fileRows: WithTs[] = (files ?? []).map((d) => ({
      key: `file-${d.id}`,
      icon: getFileIcon(d.original_name),
      name: d.original_name,
      meta: formatDate(d.created_at),
      dragData: `file:${d.id}`,
      dragName: d.original_name,
      onOpen: () => onOpenFile(d.file_path),
      onArchive: () => setArchiveTarget({ type: "file", id: d.id, name: d.original_name }),
      onDelete: () => setDeleteTarget({ type: "file", id: d.id, name: d.original_name }),
      ts: Date.parse(d.created_at) || 0,
    }));
    return [...postRows, ...fileRows].sort((a, b) => b.ts - a.ts);
  }, [loading, unarchivedPosts, files, onOpenBlog, onOpenFile]);

  return (
    <WorkspaceView>
      <SectionCard
        title={`未分类 · ${loading ? 0 : total}`}
        icon={Inbox}
        actions={
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              上传文件
            </Button>
            <Button size="sm" variant="ghost" onClick={onCreateBlog}>
              <Plus className="h-3.5 w-3.5" />
              新建文章
            </Button>
          </div>
        }
      >
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
          <ul className="flex flex-col">
            {rows.map((r) => (
              <InboxRowItem key={r.key} {...r} />
            ))}
          </ul>
        )}
      </SectionCard>
      <Input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.xlsx"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleFileChange(event);
        }}
      />
      <ArchiveToFolderDialog
        open={archiveTarget !== null}
        target={archiveTarget}
        onClose={() => setArchiveTarget(null)}
      />
      <DeleteResourceDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </WorkspaceView>
  );
}
