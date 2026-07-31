import { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Home, LayoutDashboard, Network, type LucideIcon } from "lucide-react";
import { useChatDispatch } from "@/stores/chatStore";
import { useAuth, type AuthUser } from "@/stores/authStore";

export type PrimaryNavigationKey = "home" | "research" | "workspace";
type LoginDestination = Exclude<PrimaryNavigationKey, "home">;

export interface PrimaryNavigationItem {
  key: PrimaryNavigationKey;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

export function useWorkspacePrimaryNavigation() {
  const dispatch = useChatDispatch();
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [pendingLoginDestination, setPendingLoginDestination] = useState<LoginDestination | null>(null);

  const resetBlogList = useCallback(() => {
    dispatch({ type: "SET_PAGE", payload: "blog" });
    dispatch({ type: "SET_BLOG_VIEW", payload: "list" });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
  }, [dispatch]);

  const openLoginDialog = useCallback((destination: LoginDestination | null = null) => {
    setPendingLoginDestination(destination);
    setLoginDialogOpen(true);
  }, []);

  const handleHome = useCallback(() => {
    resetBlogList();
    if (user?.username) {
      navigate(`/u/${encodeURIComponent(user.username)}`);
      return;
    }
    navigate("/");
  }, [navigate, resetBlogList, user]);

  const handleResearch = useCallback(() => {
    if (!isAuthenticated) {
      openLoginDialog("research");
      return;
    }
    dispatch({ type: "SET_PAGE", payload: "research" });
    navigate("/research");
  }, [dispatch, isAuthenticated, navigate, openLoginDialog]);

  const handleWorkspace = useCallback(() => {
    if (!isAuthenticated) {
      openLoginDialog("workspace");
      return;
    }
    navigate("/workspace");
  }, [isAuthenticated, navigate, openLoginDialog]);

  const handleLoginSuccess = useCallback((loggedInUser: AuthUser) => {
    const destination = pendingLoginDestination;
    setPendingLoginDestination(null);

    if (destination === "research") {
      dispatch({ type: "SET_PAGE", payload: "research" });
      navigate("/research");
      return;
    }

    if (destination === "workspace") {
      navigate("/workspace");
      return;
    }

    resetBlogList();
    navigate(`/u/${encodeURIComponent(loggedInUser.username)}`);
  }, [dispatch, navigate, pendingLoginDestination, resetBlogList]);

  const activePrimaryPage: PrimaryNavigationKey | null = location.pathname === "/workspace"
    ? "workspace"
    : location.pathname.startsWith("/research")
        ? "research"
        : location.pathname === "/" || location.pathname.startsWith("/u/")
          ? "home"
          : null;

  const primaryNavigation = useMemo<PrimaryNavigationItem[]>(() => [
    { key: "home", label: "首页", icon: Home, onClick: handleHome },
    { key: "workspace", label: "创作", icon: LayoutDashboard, onClick: handleWorkspace },
    { key: "research", label: "研究图谱", icon: Network, onClick: handleResearch },
  ], [handleHome, handleResearch, handleWorkspace]);

  return {
    activePrimaryPage,
    primaryNavigation,
    loginDialogOpen,
    setLoginDialogOpen,
    openLoginDialog,
    handleHome,
    handleWorkspace,
    handleLoginSuccess,
  };
}
