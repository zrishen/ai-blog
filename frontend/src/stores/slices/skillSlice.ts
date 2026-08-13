import type { ChatState, ChatAction } from "../chatStore";

// skill slice：用户显式启用的 agent skill 集合。
// enabledSkills=null=未加载完成（禁止发送）；非空=已加载启用集（[]=显式全关）。
// SET_ENABLED_SKILLS 同时标记加载完成（成功加载）；SET_SKILLS_LOADED 用于加载失败时单独放行守卫。
export function skillReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_ENABLED_SKILLS":
      return { ...state, enabledSkills: [...action.payload], skillsLoaded: true };
    case "SET_SKILLS_LOADED":
      return { ...state, skillsLoaded: action.payload };
    default:
      return state;
  }
}
