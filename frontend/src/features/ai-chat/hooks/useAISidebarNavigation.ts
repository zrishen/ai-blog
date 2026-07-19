import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useChat } from "../../../stores/chatStore";
import type { AuthUser } from "../../../stores/authStore";

// 登录跳转子领域：未登录点文件/研究入口时弹登录框记下意图，登录成功后按意图跳转；
// 无意图则回博客列表。从 AISidebar 抽出，行为不变。
export function useAISidebarNavigation(isAuthenticated: boolean) {
  const { dispatch } = useChat();
  const navigate = useNavigate();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginRedirectTarget, setLoginRedirectTarget] = useState<"files" | "research" | null>(null);

  const handleFiles = useCallback(() => {
    if (!isAuthenticated) {
      setLoginRedirectTarget("files");
      setLoginDialogOpen(true);
      return;
    }
    dispatch({ type: "SET_PAGE", payload: "files" });
    navigate("/files");
  }, [dispatch, navigate, isAuthenticated]);

  const handleResearch = useCallback(() => {
    if (!isAuthenticated) {
      setLoginRedirectTarget("research");
      setLoginDialogOpen(true);
      return;
    }
    dispatch({ type: "SET_PAGE", payload: "research" });
    navigate("/research");
  }, [dispatch, navigate, isAuthenticated]);

  const handleLoginSuccess = useCallback((loggedInUser: AuthUser) => {
    if (loginRedirectTarget === "files") {
      setLoginRedirectTarget(null);
      dispatch({ type: "SET_PAGE", payload: "files" });
      navigate("/files");
      return;
    }
    if (loginRedirectTarget === "research") {
      setLoginRedirectTarget(null);
      dispatch({ type: "SET_PAGE", payload: "research" });
      navigate("/research");
      return;
    }
    dispatch({ type: "SET_PAGE", payload: "blog" });
    dispatch({ type: "SET_BLOG_VIEW", payload: "list" });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
    navigate(`/u/${encodeURIComponent(loggedInUser.username)}`);
  }, [dispatch, navigate, loginRedirectTarget]);

  return {
    loginDialogOpen,
    setLoginDialogOpen,
    handleFiles,
    handleResearch,
    handleLoginSuccess,
  };
}
