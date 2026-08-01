import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  attachResearchTopicToPost,
  createBlogPost,
  draftResearch,
  getResearchTopic,
  listResearchRuns,
  runResearchTopic,
} from "../../../api/client";
import type { ResearchRun } from "../../../api/client";
import { useChat } from "../../../stores/chatStore";

export interface ResearchRunsState {
  runs: ResearchRun[];
  selectedRunId: number | null;
  selectedRun: ResearchRun | null;
  isRunning: boolean;
  loading: boolean;
  error: string | null;
  starting: boolean;
  drafting: boolean;
  setSelectedRunId: (id: number | null) => void;
  setError: (value: string | null) => void;
  handleStart: () => Promise<void>;
  handleRefresh: () => void;
  handleTabJump: (tab: string) => void;
  handleWriteDraft: () => Promise<void>;
  handleQuickDraft: () => Promise<void>;
}

export function useResearchRuns(topicId: number): ResearchRunsState {
  const navigate = useNavigate();
  const { dispatch, state } = useChat();
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const selectedRunIdRef = useRef<number | null>(null);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;
  const isRunning = selectedRun?.status === "running" || selectedRun?.status === "processing";

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  const loadRuns = useCallback(async (selectLatest = false) => {
    try {
      const data = await listResearchRuns(topicId);
      if (!mountedRef.current) return;
      setRuns(data);
      if (data.length > 0 && (selectLatest || !selectedRunIdRef.current)) {
        setSelectedRunId(data[0].id);
      }
      setError(null);
    } catch {
      if (!mountedRef.current) return;
      setError("加载研究运行记录失败");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [topicId]);

  useEffect(() => {
    mountedRef.current = true;
    queueMicrotask(() => {
      if (mountedRef.current) void loadRuns();
    });
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadRuns]);

  useEffect(() => {
    if (!isRunning) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(() => {
      loadRuns();
    }, 4000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [isRunning, loadRuns]);

  const handleStart = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      await runResearchTopic(topicId, `process-${topicId}-${Date.now()}`);
      try {
        const detail = await getResearchTopic(topicId);
        dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
      } catch {
        // 主题详情刷新是启动研究后的最佳努力同步。
      }
      await loadRuns(true);
    } catch {
      setError("启动研究任务失败，请稍后重试");
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  }, [topicId, loadRuns, dispatch]);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    loadRuns();
  }, [loadRuns]);

  const handleTabJump = useCallback((tab: string) => {
    navigate(`/research/${topicId}?tab=${tab}`, { replace: true });
  }, [navigate, topicId]);

  const topicTitle = state.researchCurrentTopic?.title;

  const handleWriteDraft = useCallback(async () => {
    setDrafting(true);
    setError(null);
    try {
      const preview = await draftResearch(topicId);
      const post = await createBlogPost({
        title: preview.title || `${topicTitle ?? "研究"} - 博客草稿`,
        content: preview.content,
        status: "draft",
      });
      await attachResearchTopicToPost(post.id, topicId);
      navigate(`/blog/edit/${post.id}`, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`生成草稿失败：${msg}`);
    } finally {
      if (mountedRef.current) setDrafting(false);
    }
  }, [topicId, topicTitle, navigate]);

  const handleQuickDraft = useCallback(async () => {
    setDrafting(true);
    setError(null);
    try {
      const post = await createBlogPost({
        title: `${topicTitle ?? "研究"} - 博客草稿`,
        content: "",
        status: "draft",
      });
      await attachResearchTopicToPost(post.id, topicId);
      navigate(`/blog/edit/${post.id}`, { replace: true });
    } catch {
      setError("创建草稿失败，请稍后重试");
    } finally {
      if (mountedRef.current) setDrafting(false);
    }
  }, [topicId, topicTitle, navigate]);

  return {
    runs,
    selectedRunId,
    selectedRun,
    isRunning,
    loading,
    error,
    starting,
    drafting,
    setSelectedRunId,
    setError,
    handleStart,
    handleRefresh,
    handleTabJump,
    handleWriteDraft,
    handleQuickDraft,
  };
}
