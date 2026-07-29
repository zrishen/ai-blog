import { useEffect, useState } from "react";
import { CheckCircle2, Database, FileText, Sparkles, type LucideIcon } from "lucide-react";
import { listBlogPosts, listFileDocuments } from "../../../api/client";
import { listAiKnowledge } from "../../../api/workspace";
import { Badge } from "@/components/ui/badge";
import { LoadingState, WorkspaceView } from "./shared";
import { formatDate } from "./utils";

interface RecentItem {
  id: number;
  title: string;
  kind: "draft" | "published";
  updated: string;
}

export function OverviewView({ onOpenBlog }: { onOpenBlog: (id: number) => void }) {
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
                  {recent.map((it) => (
                    <li key={`${it.kind}-${it.id}`}>
                      <button
                        type="button"
                        onClick={() => onOpenBlog(it.id)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary/60"
                      >
                        <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
                          {it.title || "无标题"}
                        </span>
                        <Badge variant={it.kind === "draft" ? "warning" : "success"}>
                          {it.kind === "draft" ? "草稿" : "已发布"}
                        </Badge>
                        <span className="text-fine text-muted-foreground">{formatDate(it.updated)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}
    </WorkspaceView>
  );
}

// 扁平统计块：轻底色区块（不浮起、无边框无阴影），贴边风格下替代浮起的 StatCard。
function StatBlock({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
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
