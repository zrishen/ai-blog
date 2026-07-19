import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useChat } from "../../../stores/chatStore";

// 登录跳转子领域：未登录点文件/研究入口时记下跳转意图；
// 从 MCP 入口登录时没有路由跳转意图，登录成功后留在当前页面。
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

  const handleLoginSuccess = useCallback(() => {
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
    setLoginRedirectTarget(null);
  }, [dispatch, navigate, loginRedirectTarget]);

  return {
    loginDialogOpen,
    setLoginDialogOpen,
    handleFiles,
    handleResearch,
    handleLoginSuccess,
  };
}
