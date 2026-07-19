import type { ChatState, ChatAction } from "../chatStore";

// Research 领域切片：处理 research 相关 action，其它 action 原样返回。
export function researchReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_RESEARCH_TOPICS":
      return { ...state, researchTopics: action.payload };
    case "SET_RESEARCH_CURRENT_TOPIC_ID":
      return { ...state, researchCurrentTopicId: action.payload };
    case "SET_RESEARCH_CURRENT_TOPIC":
      return { ...state, researchCurrentTopic: action.payload };
    case "SET_RESEARCH_SELECTED_CLAIM_ID":
      return { ...state, researchSelectedClaimId: action.payload };
    case "SET_RESEARCH_SELECTED_CONFLICT_ID":
      return { ...state, researchSelectedConflictId: action.payload };
    case "SET_RESEARCH_SELECTED_PROPOSAL_ID":
      return { ...state, researchSelectedProposalId: action.payload };
    case "SET_TRUST_WRITING_ENABLED":
      return { ...state, trustWritingEnabled: action.payload };
    case "SET_PENDING_RESEARCH_PROMPT":
      return { ...state, pendingResearchPrompt: action.payload };
    default:
      return state;
  }
}
