import { useEffect, useMemo, useState } from "react";
import { FileStack, FileText } from "lucide-react";
import { joinAiKnowledge, listBlogPosts, listFileDocuments } from "../../../api/client";
import type { RagSource } from "../../../api/workspace";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Candidate {
  key: string; // "file:123" / "blog_post:456"
  type: "file" | "blog_post";
  name: string;
}

/** 加入 AI 知识：列出全部文件/文章（排除已加入），多选后批量 join。 */
export function JoinAiKnowledgeDialog({
  open,
  onClose,
  onDone,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  existing: RagSource[];
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const existingSet = useMemo(
    // 失败的允许重新加入（重试索引），不排除
    () =>
      new Set(
        existing
          .filter((it) => it.index_status !== "failed")
          .map((it) => `${it.resource_type}:${it.resource_id}`),
      ),
    [existing],
  );

  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all([listFileDocuments(), listBlogPosts()])
      .then(([f, b]) => {
        if (!alive) return;
        const docs: Candidate[] = f.documents.map((d) => ({
          key: `file:${d.id}`,
          type: "file",
          name: d.original_name,
        }));
        const posts: Candidate[] = b.posts.map((p) => ({
          key: `blog_post:${p.id}`,
          type: "blog_post",
          name: p.title || "无标题",
        }));
        setCandidates([...docs, ...posts].filter((c) => !existingSet.has(c.key)));
      })
      .catch(() => alive && setCandidates([]));
    return () => {
      alive = false;
    };
  }, [open, existingSet]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const confirm = async () => {
    setBusy(true);
    try {
      for (const key of selected) {
        const [type, idStr] = key.split(":");
        await joinAiKnowledge(type, Number(idStr));
      }
      setSelected(new Set());
      onDone();
      onClose();
    } catch (e) {
      console.error("[workspace] 加入 AI 知识失败:", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSelected(new Set());
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-[420px] gap-0 p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-body-lg">加入 AI 知识</DialogTitle>
          <DialogDescription className="text-meta">
            选择文件或文章，加入后 AI 对话检索时即可引用。
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto p-2">
          {candidates === null ? (
            <p className="px-2 py-6 text-center text-body text-muted-foreground">加载中…</p>
          ) : candidates.length === 0 ? (
            <p className="px-2 py-6 text-center text-body text-muted-foreground">
              没有可加入的资源（全部已在 AI 知识中）。
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {candidates.map((c) => {
                const isSel = selected.has(c.key);
                const Icon = c.type === "file" ? FileStack : FileText;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => toggle(c.key)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-body transition-colors",
                      isSel ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent",
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="text-caption text-muted-foreground">
                      {c.type === "file" ? "文件" : "文章"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter className="border-t border-border px-4 py-3">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={confirm} disabled={selected.size === 0 || busy}>
            {busy ? "加入中…" : `加入${selected.size > 0 ? ` (${selected.size})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
