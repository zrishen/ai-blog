import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertCircle, BrainCircuit, CheckCircle2, FileSearch, GitBranch } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionTitle } from "@/components/ui/section-title";
import { useAuth } from "../../stores/authStore";
import { useChat } from "../../stores/chatStore";
import { getResearchTopic } from "../../api/client";
import { LoginDialog } from "../auth/LoginDialog";
import { ResearchGraphView } from "./ResearchGraphView";
import { ResearchProcessPanel } from "./ResearchProcessPanel";
import { useResearchTopicActions } from "./hooks/useResearchTopicActions";
import { isResearchTabKey, RESEARCH_TABS, type ResearchTabKey } from "./utils/researchFormat";
import { OverviewTab } from "./tabs/OverviewTab";
import { ClaimsTab } from "./tabs/ClaimsTab";
import { SourcesTab } from "./tabs/SourcesTab";
import { ConflictsTab } from "./tabs/ConflictsTab";
import { ProposalsTab } from "./tabs/ProposalsTab";

export function ResearchGraphPage() {
  const { topicId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();
  const { state, dispatch } = useChat();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ResearchTabKey>(() => {
    const tab = searchParams.get("tab");
    return isResearchTabKey(tab) ? tab : "overview";
  });

  const actions = useResearchTopicActions();
  const { selectedTopic, topicId: currentTopicId, error, runNote, proposalNote, conflictNote } = actions;

  useEffect(() => {
    const tab = searchParams.get("tab");
    const nextTab = isResearchTabKey(tab) ? tab : "overview";
    const timer = setTimeout(() => {
      setActiveTab((current) => (current === nextTab ? current : nextTab));
    }, 0);
    return () => clearTimeout(timer);
  }, [searchParams]);

  const handleTabChange = useCallback((key: ResearchTabKey) => {
    setActiveTab(key);
    const nextSearchParams = new URLSearchParams(searchParams);
    if (key === "overview") {
      nextSearchParams.delete("tab");
    } else {
      nextSearchParams.set("tab", key);
    }
    setSearchParams(nextSearchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // Sync URL topicId to state and load detail
  useEffect(() => {
    const routeTopicId = topicId ? Number(topicId) : null;
    if (routeTopicId && routeTopicId !== state.researchCurrentTopicId) {
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: routeTopicId });
      dispatch({ type: "SET_RESEARCH_SELECTED_CLAIM_ID", payload: null });
      dispatch({ type: "SET_RESEARCH_SELECTED_CONFLICT_ID", payload: null });
      dispatch({ type: "SET_RESEARCH_SELECTED_PROPOSAL_ID", payload: null });
      getResearchTopic(routeTopicId)
        .then((detail) => dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail }))
        .catch((err) => actions.setError(err instanceof Error ? err.message : "研究主题加载失败"));
    } else if (!routeTopicId && state.researchTopics.length > 0 && !state.researchCurrentTopicId) {
      const first = state.researchTopics[0];
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: first.id });
      navigate(`/research/${first.id}`, { replace: true });
      getResearchTopic(first.id)
        .then((detail) => dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail }))
        .catch((err) => actions.setError(err instanceof Error ? err.message : "研究主题加载失败"));
    } else if (!routeTopicId && state.researchTopics.length === 0) {
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: null });
    }
  }, [topicId, state.researchTopics]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAuthenticated) {
    return (
      <div className="flex h-full flex-col overflow-y-auto bg-background px-8 py-6">
        <div className="mx-auto flex min-h-[60vh] w-full max-w-[760px] items-center justify-center">
          <div className="relative w-full overflow-hidden rounded-feature border border-border/70 bg-card/86 p-8 text-center shadow-xl shadow-foreground/5 backdrop-blur-xl">
            <div className="relative mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-panel bg-primary/10 text-primary ring-1 ring-primary/15">
              <GitBranch className="h-7 w-7" />
            </div>
            <div className="relative mb-3 text-caption font-bold uppercase tracking-[0.18em] text-primary/80">Research Graph</div>
            <SectionTitle as="h1" size="3xl" className="relative">登录后查看研究图谱</SectionTitle>
            <p className="relative mx-auto mt-3 max-w-md text-body leading-relaxed text-muted-foreground">
              登录后可创建研究主题、审核事实依据，并把可信事实关联到博客写作流程。
            </p>
            <Button className="relative mt-6 rounded-full shadow-lg shadow-primary/20" onClick={() => setLoginDialogOpen(true)}>
              登录到 AI Blog
            </Button>
          </div>
        </div>
        <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background p-2">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-shell border border-border/70 bg-card/86 shadow-xl shadow-foreground/5 backdrop-blur-xl">
        <div className="border-b border-border/70 p-3 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-meta font-semibold text-primary">
                <BrainCircuit className="h-3.5 w-3.5" />
                事实审核台
              </div>
              <SectionTitle as="h1" size="2xl" className="sm:text-3xl">{selectedTopic?.title ?? "研究图谱"}</SectionTitle>
              <p className="mt-2 max-w-2xl text-body-lg leading-relaxed text-muted-foreground">
                {selectedTopic?.description || "围绕主题整理来源、证据、事实、冲突和 Agent 更新提案。"}
              </p>
            </div>
            <Button className="rounded-full shadow-lg shadow-primary/20" onClick={actions.handleRunTopic} disabled={!currentTopicId}>
              <FileSearch className="h-3.5 w-3.5" />
              更新图谱
            </Button>
          </div>

          {error && (
            <Alert variant="destructive" role="alert" className="mt-4 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </Alert>
          )}

          {proposalNote && (
            <Alert variant="success" className="mt-4 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              {proposalNote}
            </Alert>
          )}

          {conflictNote && (
            <Alert variant="success" className="mt-4 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              {conflictNote}
            </Alert>
          )}

          {runNote && (
            <Alert variant="info" className="mt-4 flex items-center gap-2">
              <FileSearch className="h-4 w-4" />
              {runNote}
            </Alert>
          )}
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-border/70 px-3 py-2 sm:px-4">
          {RESEARCH_TABS.map(([key, label]) => (
            <Button
              key={key}
              variant={activeTab === key ? "default" : "ghost"}
              size="sm"
              className="flex-shrink-0 rounded-full"
              onClick={() => handleTabChange(key)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {!selectedTopic ? (
            <EmptyState
              icon={GitBranch}
              title="暂无可审核主题"
              description="创建主题后，这里会展示来源、事实、冲突和提案。"
              className="h-full min-h-[360px] rounded-surface p-8"
            />
          ) : activeTab === "overview" ? (
            <OverviewTab topic={selectedTopic} />
          ) : activeTab === "process" ? (
            <ResearchProcessPanel topicId={selectedTopic.id} />
          ) : activeTab === "claims" ? (
            <ClaimsTab topic={selectedTopic} actions={actions} />
          ) : activeTab === "sources" ? (
            <SourcesTab topic={selectedTopic} />
          ) : activeTab === "conflicts" ? (
            <ConflictsTab actions={actions} />
          ) : activeTab === "graph" ? (
            <ResearchGraphView topic={selectedTopic} />
          ) : (
            <ProposalsTab topic={selectedTopic} actions={actions} />
          )}
        </div>
      </section>
    </div>
  );
}
