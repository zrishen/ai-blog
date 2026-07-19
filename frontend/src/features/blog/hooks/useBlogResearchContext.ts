import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useChat } from "../../../stores/chatStore";
import { getBlogResearchSummary, getResearchTopic, type BlogResearchSummary } from "../../../api/client";
import type { BlogPost } from "../types";
import { recordNumber } from "../utils/blogEditorTypes";

// 研究写作子领域：加载文章关联的研究摘要 + 研究写作/图谱跳转入口。
// 从 BlogEditor 抽出，state/effect/派生/handler 内聚于此；不改行为。
export function useBlogResearchContext(existingPost: BlogPost | undefined) {
  const { state, dispatch } = useChat();
  const navigate = useNavigate();
  const [researchSummary, setResearchSummary] = useState<BlogResearchSummary | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!existingPost?.id) {
      setResearchSummary(null);
      setResearchError(null);
      setResearchLoading(false);
      return;
    }
    let cancelled = false;
    setResearchLoading(true);
    setResearchError(null);
    getBlogResearchSummary(existingPost.id)
      .then((summary) => {
        if (!cancelled) setResearchSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setResearchError("事实依据加载失败，请稍后重试");
      })
      .finally(() => {
        if (!cancelled) setResearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [existingPost?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const linkedTopics = researchSummary?.topics ?? [];
  const adoptedClaims = researchSummary?.claims ?? [];
  const fallbackTopicId = state.researchCurrentTopicId ?? (linkedTopics[0] ? recordNumber(linkedTopics[0], "id") : null);
  const hasResearchContext = Boolean(
    existingPost
    || state.researchCurrentTopic
    || state.trustWritingEnabled
    || linkedTopics.length
    || adoptedClaims.length,
  );

  const ensureResearchTopicContext = useCallback(async () => {
    if (!fallbackTopicId || fallbackTopicId === state.researchCurrentTopicId) return;
    dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: fallbackTopicId });
    try {
      const detail = await getResearchTopic(fallbackTopicId);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
    } catch { /* 自动加载研究主题失败时静默；用户可在研究页面手动重试 */ }
  }, [dispatch, fallbackTopicId, state.researchCurrentTopicId]);

  const handleGoResearchGraph = useCallback(() => {
    dispatch({ type: "SET_PAGE", payload: "research" });
    navigate(fallbackTopicId ? `/research/${fallbackTopicId}` : "/research");
  }, [dispatch, navigate, fallbackTopicId]);

  const handleOpenResearchWriting = useCallback(async (choiceMode: "open" | "draft") => {
    await ensureResearchTopicContext();
    dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: true });
    dispatch({ type: "SET_TRUST_WRITING_ENABLED", payload: true });
    dispatch({ type: "SET_PENDING_RESEARCH_PROMPT", payload: choiceMode === "draft" ? "draft_research_choices" : "open_research_choices" });
  }, [dispatch, ensureResearchTopicContext]);

  return {
    researchSummary,
    researchLoading,
    researchError,
    linkedTopics,
    adoptedClaims,
    fallbackTopicId,
    hasResearchContext,
    ensureResearchTopicContext,
    handleGoResearchGraph,
    handleOpenResearchWriting,
  };
}
