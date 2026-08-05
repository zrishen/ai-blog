import { useCallback, useEffect, useState } from "react";
import { Network, Plus, Sparkles, X } from "lucide-react";
import { BlogIcon } from "@/components/icons";
import { getFileIcon } from "@/components/fileIcons";
import { leaveAiKnowledge, listAiKnowledge, type RagSource } from "../../../api/workspace";
import { listBlogPosts, listFileDocuments, type BlogPostData, type FileDocument } from "../../../api/client";
import { JoinAiKnowledgeDialog } from "../components/JoinAiKnowledgeDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState, SectionCard, WorkspaceView } from "./shared";
import { FileProcessingProgress } from "@/features/file-processing/FileProcessingProgress";
import { jobStage, useFileProcessing } from "@/features/file-processing/FileProcessingProvider";
import { useChat } from "../../../stores/chatStore";
import { cn } from "@/lib/utils";

// 状态徽标已精简：索引中显示进度条，失败显示红字「失败」，其余状态不标记。

interface AiKnowledgeData {
  rag: RagSource[];
  docs: FileDocument[];
  posts: BlogPostData[];
}

export function AiKnowledgeView({
  onOpenBlog,
  onOpenFile,
}: {
  onOpenBlog: (id: number) => void;
  onOpenFile: (filePath: string) => void;
}) {
  const { state } = useChat();
  const { indexJobs, optimisticKeys, consumeOptimistic } = useFileProcessing();
  const [data, setData] = useState<AiKnowledgeData | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const reload = useCallback(() => {
    return Promise.all([listAiKnowledge(), listFileDocuments(), listBlogPosts()])
      .then(([rag, files, blogs]) => {
        setData({ rag, docs: files.documents, posts: blogs.posts });
        const realKeys = new Set(rag.map((r) => `${r.resource_type}:${r.resource_id}`));
        consumeOptimistic(realKeys);
      })
      .catch(() => setData({ rag: [], docs: [], posts: [] }));
  }, [consumeOptimistic]);

  useEffect(() => {
    reload();
  }, [reload, state.aiKnowledgeRevision]);

  // RagSource 不含 name,按 resource_type 在文件/文章列表里反查真实名称
  const nameOf = (it: RagSource): string => {
    if (!data) return "";
    if (it.resource_type === "file") {
      const d = data.docs.find((x) => x.id === it.resource_id);
      return d ? d.original_name : `文件 #${it.resource_id}`;
    }
    if (it.resource_type === "blog_post") {
      const p = data.posts.find((x) => x.id === it.resource_id);
      return p ? (p.title || "无标题") : `文章 #${it.resource_id}`;
    }
    return `${it.resource_type} #${it.resource_id}`;
  };

  // 点击打开：文章→内联编辑，文件→内联预览（反查 file_path），研究类不可打开
  const openResource = async (it: RagSource) => {
    if (it.resource_type === "blog_post" && it.resource_id != null) {
      onOpenBlog(it.resource_id);
    } else if (it.resource_type === "file" && it.resource_id != null) {
      let doc = data?.docs.find((d) => d.id === it.resource_id);
      if (!doc) {
        try {
          const response = await listFileDocuments();
          setData((current) => (current ? { ...current, docs: response.documents } : current));
          doc = response.documents.find((d) => d.id === it.resource_id);
        } catch {
          return;
        }
      }
      if (doc) onOpenFile(doc.file_path);
    }
  };

  const handleRemove = useCallback(
    async (it: RagSource) => {
      const key = `${it.resource_type}:${it.resource_id}`;
      setRemovingKey(key);
      try {
        await leaveAiKnowledge(it.resource_type, it.resource_id);
        await reload();
      } catch (e) {
        console.error("[workspace] 移出 AI 知识失败:", e);
      } finally {
        setRemovingKey(null);
      }
    },
    [reload],
  );

  const realRag = data?.rag ?? null;
  const realKeys = new Set((realRag ?? []).map((r) => `${r.resource_type}:${r.resource_id}`));
  const optimisticItems: RagSource[] = optimisticKeys
    .filter((k) => !realKeys.has(k))
    .map((k) => {
      const [t, idStr] = k.split(":");
      return { resource_type: t, resource_id: Number(idStr), index_status: "pending" } as RagSource;
    });
  const items: RagSource[] | null = realRag === null ? null : [...optimisticItems, ...realRag];
  const ragList = realRag ?? [];

  return (
    <WorkspaceView>
      {items === null ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="还没有 AI 知识"
            description="加入文件或文章后，AI 对话检索时即可引用。"
            action={
              <Button onClick={() => setJoinOpen(true)}>
                <Plus className="h-4 w-4" />
                加入资源
              </Button>
            }
            className="flex-1 p-10"
          />
        ) : (
          <SectionCard
            title={`AI 知识 · ${items.length}`}
            icon={Sparkles}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setJoinOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                加入资源
              </Button>
            }
          >
            <ul className="flex flex-col">
              {items.map((it) => {
                const key = `${it.resource_type}:${it.resource_id}`;
                const openable = it.resource_type === "blog_post" || it.resource_type === "file";
                const indexJob = indexJobs[key];
                return (
                  <li
                    key={key}
                    className="group flex items-center gap-3 rounded-control px-3 py-2 hover:bg-secondary/60"
                  >
                    {it.resource_type === "blog_post" ? (
                      <BlogIcon className="h-4 w-4 flex-shrink-0" />
                    ) : it.resource_type === "file" ? (
                      getFileIcon(nameOf(it))
                    ) : (
                      <Network className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    )}
                    <button
                      type="button"
                      disabled={!openable}
                      onClick={() => {
                        void openResource(it);
                      }}
                      className={cn(
                        "min-w-0 flex-1 truncate text-left text-body font-medium",
                        openable
                          ? "cursor-pointer text-foreground"
                          : "cursor-default text-muted-foreground",
                      )}
                    >
                      {nameOf(it)}
                    </button>
                    {indexJob ? (
                      <div className="w-56 shrink-0">
                        <FileProcessingProgress
                          value={{ percent: indexJob.progress_percent, stage: jobStage(indexJob), job: indexJob }}
                        />
                      </div>
                    ) : it.index_status === "failed" ? (
                      <Badge variant="destructive">失败</Badge>
                    ) : null}
                    {realKeys.has(key) && (
                      <button
                        type="button"
                        aria-label="移出 AI 知识"
                        onClick={() => handleRemove(it)}
                        disabled={removingKey === key}
                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        )}
      <JoinAiKnowledgeDialog
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        existing={ragList}
      />
    </WorkspaceView>
  );
}
