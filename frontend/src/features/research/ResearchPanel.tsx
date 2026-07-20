import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useChat } from "../../stores/chatStore";
import { useAuth } from "../../stores/authStore";
import {
  listResearchTopics,
  createResearchTopic,
  getResearchTopic,
  deleteResearchTopic,
} from "../../api/client";
import { motion } from "motion/react";
import { Trash2, Plus, Loader2, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { statusLabel as researchStatusLabel } from "./utils/researchFormat";

export function ResearchPanel() {
  const { state, dispatch } = useChat();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [newResearchTitle, setNewResearchTitle] = useState("");
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchDeleteTarget, setResearchDeleteTarget] = useState<{
    id: number;
    title: string;
  } | null>(null);
  const [researchDeletingId, setResearchDeletingId] = useState<number | null>(null);
  const [researchActionError, setResearchActionError] = useState<string | null>(null);

  const loadResearchTopics = useCallback(async () => {
    if (!isAuthenticated) return;
    setResearchLoading(true);
    setResearchActionError(null);
    try {
      const topics = await listResearchTopics();
      dispatch({ type: "SET_RESEARCH_TOPICS", payload: topics });
    } catch {
      // silent
    } finally {
      setResearchLoading(false);
    }
  }, [dispatch, isAuthenticated]);

  useEffect(() => {
    if (state.currentPage === "research" && isAuthenticated) {
      // 异步加载研究主题；rule 无法识别 useCallback 内的同步 setState 是异步链入口
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadResearchTopics();
    }
  }, [isAuthenticated, state.currentPage, loadResearchTopics]);

  const handleCreateResearchTopic = useCallback(async () => {
    const title = newResearchTitle.trim();
    if (!title) return;
    setResearchActionError(null);
    try {
      const topic = await createResearchTopic({ title });
      dispatch({ type: "SET_RESEARCH_TOPICS", payload: [topic, ...state.researchTopics] });
      setNewResearchTitle("");
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: topic.id });
      dispatch({ type: "SET_RESEARCH_SELECTED_CLAIM_ID", payload: null });
      dispatch({ type: "SET_RESEARCH_SELECTED_CONFLICT_ID", payload: null });
      dispatch({ type: "SET_RESEARCH_SELECTED_PROPOSAL_ID", payload: null });
      navigate(`/research/${topic.id}`);
      const detail = await getResearchTopic(topic.id);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
    } catch {
      // silent
    }
  }, [dispatch, navigate, newResearchTitle, state.researchTopics]);

  const selectResearchTopic = useCallback(async (id: number) => {
    dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: id });
    dispatch({ type: "SET_RESEARCH_SELECTED_CLAIM_ID", payload: null });
    dispatch({ type: "SET_RESEARCH_SELECTED_CONFLICT_ID", payload: null });
    navigate(`/research/${id}`);
    try {
      const detail = await getResearchTopic(id);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
    } catch {
      // silent
    }
  }, [dispatch, navigate]);

  const handleConfirmDeleteResearchTopic = useCallback(async () => {
    if (!researchDeleteTarget || researchDeletingId !== null) return;
    const { id } = researchDeleteTarget;
    setResearchDeletingId(id);
    setResearchActionError(null);
    try {
      await deleteResearchTopic(id);
      dispatch({
        type: "SET_RESEARCH_TOPICS",
        payload: state.researchTopics.filter((topic) => topic.id !== id),
      });
      if (state.researchCurrentTopicId === id) {
        dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: null });
        dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: null });
        dispatch({ type: "SET_RESEARCH_SELECTED_CLAIM_ID", payload: null });
        dispatch({ type: "SET_RESEARCH_SELECTED_CONFLICT_ID", payload: null });
        navigate("/research");
      }
      await loadResearchTopics();
    } catch (err) {
      console.error("Failed to delete research topic:", err);
      setResearchActionError(err instanceof Error ? err.message : "删除研究主题失败");
    } finally {
      setResearchDeletingId(null);
      setResearchDeleteTarget(null);
    }
  }, [dispatch, loadResearchTopics, navigate, researchDeleteTarget, researchDeletingId, state.researchCurrentTopicId, state.researchTopics]);

  if (!isAuthenticated) {
    return (
      <aside className="w-full h-full bg-card/82 backdrop-blur-xl border-r border-border/80 flex flex-col overflow-y-auto select-none shadow-[12px_0_35px_hsl(var(--foreground)/0.03)]" />
    );
  }

  return (
    <aside className="w-full h-full bg-card/82 backdrop-blur-xl border-r border-border/80 flex flex-col overflow-y-auto select-none shadow-[12px_0_35px_hsl(var(--foreground)/0.03)]">
      <div className="p-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <Input
            value={newResearchTitle}
            onChange={(e) => setNewResearchTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreateResearchTopic(); }}
            placeholder="新建研究主题"
            className="rounded-full bg-background/70 text-sm"
          />
          <Button size="icon" className="shrink-0 rounded-full" onClick={handleCreateResearchTopic} disabled={!newResearchTitle.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {researchActionError && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/8 px-3 py-2 text-[13px] text-destructive">
            {researchActionError}
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {state.researchTopics.length === 0 && !researchLoading ? (
            <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/50 px-3 py-4 text-center text-[13px] text-muted-foreground">
              暂无研究主题，先创建一个主题开始收集来源和事实。
            </div>
          ) : state.researchTopics.map((topic) => {
            const isActive = topic.id === state.researchCurrentTopicId;
            const statusColor = topic.status === "draft" ? "bg-muted-foreground/20"
              : topic.status === "researching" ? "bg-blue-500"
              : topic.status === "ready" ? "bg-emerald-500"
              : topic.status === "stale" ? "bg-amber-500"
              : "bg-primary";
            return (
              <ContextMenu key={topic.id}>
                <ContextMenuTrigger asChild>
                  <motion.button
                    whileHover={{ x: researchDeletingId === topic.id ? 0 : 3 }}
                    transition={{ duration: 0.15 }}
                    className={`group w-full rounded-[1.25rem] border p-3 text-left transition-colors ${
                      isActive
                        ? "border-primary/30 bg-primary/8 shadow-sm shadow-primary/8"
                        : "border-border/60 bg-card/70 hover:border-primary/18 hover:bg-accent/50"
                    } ${researchDeletingId === topic.id ? "opacity-60" : ""}`}
                    onClick={() => selectResearchTopic(topic.id)}
                    disabled={researchDeletingId === topic.id}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl ${isActive ? "bg-primary/12" : "bg-secondary/80"} transition-colors`}>
                        <GitBranch className={`h-3.5 w-3.5 ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"} transition-colors`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-1 text-sm font-semibold leading-snug text-foreground">{topic.title}</div>
                        {topic.description && (
                          <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{topic.description}</div>
                        )}
                      </div>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${statusColor}`} title={researchStatusLabel(topic.status)} />
                    </div>
                  </motion.button>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-44">
                  <ContextMenuItem
                    variant="destructive"
                    disabled={researchDeletingId === topic.id}
                    onClick={() => {
                      setResearchActionError(null);
                      setResearchDeleteTarget({ id: topic.id, title: topic.title });
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                    删除主题
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      </div>

      <Dialog
        open={researchDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && researchDeletingId === null) setResearchDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认永久删除</DialogTitle>
            <DialogDescription>
              确定要永久删除研究主题「{researchDeleteTarget?.title}」吗？该操作会删除关联来源、证据、事实、实体、关系、提案、运行记录以及博客引用链接，且不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={researchDeletingId !== null}>取消</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleConfirmDeleteResearchTopic}
              disabled={researchDeleteTarget === null || researchDeletingId !== null}
            >
              {researchDeletingId !== null && <Loader2 className="h-4 w-4 animate-spin" />}
              永久删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
