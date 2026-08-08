import { useEffect, useState, type ComponentType } from "react";
import { CheckCircle2, Database, FileText, Sparkles } from "lucide-react";
import { BlogIcon, PublishedIcon } from "@/components/icons";
import { getFileIcon } from "@/components/fileIcons";
import { listBlogPosts } from "@/api/blog";
import { listFileDocuments } from "@/api/files";
import { listAiKnowledge } from "@/api/workspace";
import { Badge } from "@/components/ui/badge";
import { LoadingState, WorkspaceView } from "./shared";
import { formatDate } from "./utils";

interface RecentItem {
  id: number;
  title: string;
  kind: "draft" | "published" | "file";
  updated: string;
  filePath?: string;
}

export function OverviewView({
  onOpenBlog,
  onOpenFile,
}: {
  onOpenBlog: (id: number) => void;
  onOpenFile: (filePath: string) => void;
}) {
  const [counts, setCounts] = useState({ drafts: 0, published: 0, files: 0, ai: 0 });
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [drafts, published, files, ai] = await Promise.all([
          listBlogPosts({ status: "draft" }),
          listBlogPosts({ status: "published" }),
          listFileDocuments(),
          listAiKnowledge(),
        ]);
        if (!alive) return;
        setCounts({
          drafts: drafts.posts.length,
          published: published.posts.length,
          files: files.documents.length,
          ai: ai.length,
        });
        const items: RecentItem[] = [
          ...drafts.posts.map((p) => ({
            id: p.id,
            title: p.title,
            kind: "draft" as const,
            updated: p.updated_at ?? p.created_at,
          })),
          ...published.posts.map((p) => ({
            id: p.id,
            title: p.title,
            kind: "published" as const,
            updated: p.updated_at ?? p.published_at ?? p.created_at,
          })),
          ...files.documents.map((d) => ({
            id: d.id,
            title: d.original_name,
            kind: "file" as const,
            updated: d.created_at,
            filePath: d.file_path,
          })),
        ]
          .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime())
          .slice(0, 10);
        setRecent(items);
      } catch {
        /* ignore — 保持 0 计数 */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <WorkspaceView>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBlock icon={FileText} label="草稿" value={counts.drafts} />
          <StatBlock icon={CheckCircle2} label="已发布" value={counts.published} />
          <StatBlock icon={Database} label="文件" value={counts.files} />
          <StatBlock icon={Sparkles} label="AI 知识" value={counts.ai} />
        </div>
        {loading ? (
          <LoadingState />
        ) : (
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border/60 px-1 pb-2 text-meta font-semibold text-foreground">
              <FileText className="h-4 w-4 text-primary" />
              <span>最近编辑</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {recent.length === 0 ? (
                <div className="px-3 py-10 text-center text-fine text-muted-foreground">
                  还没有内容，新建一篇草稿开始创作吧。
                </div>
              ) : (
                <ul className="flex flex-col">
                  {recent.map((it) => {
                    const isFile = it.kind === "file";
                    return (
                    <li key={`${it.kind}-${it.id}`}>
                      <button
                        type="button"
                        onClick={() =>
                          isFile && it.filePath ? onOpenFile(it.filePath) : onOpenBlog(it.id)
                        }
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary/60"
                      >
                        {isFile ? (
                          getFileIcon(it.title)
                        ) : it.kind === "published" ? (
                          <PublishedIcon className="h-4 w-4 flex-shrink-0" />
                        ) : (
                          <BlogIcon className="h-4 w-4 flex-shrink-0" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
                          {it.title || "无标题"}
                        </span>
                        <Badge variant={it.kind === "draft" ? "warning" : it.kind === "published" ? "success" : "outline"}>
                          {it.kind === "draft" ? "草稿" : it.kind === "published" ? "已发布" : "文件"}
                        </Badge>
                        <span className="text-fine text-muted-foreground">{formatDate(it.updated)}</span>
                      </button>
                    </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        )}
    </WorkspaceView>
  );
}

// 扁平统计块：轻底色区块（不浮起、无边框无阴影），贴边风格下替代浮起的 StatCard。
function StatBlock({ icon: Icon, label, value }: { icon: ComponentType<{ className?: string }>; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5 px-1 py-1">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-bold leading-tight text-foreground">{value}</div>
        <div className="text-caption text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
