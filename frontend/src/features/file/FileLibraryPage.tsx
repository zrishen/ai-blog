import { useEffect, useState } from "react";
import { useChat } from "../../stores/chatStore";
import { useAuth } from "../../stores/authStore";
import { useChatHooks } from "../../hooks/useChat";
import { listFileCategories } from "../../api/client";
import { Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Surface } from "@/components/ui/surface";
import { LoginDialog } from "../auth/LoginDialog";
import { FilePreviewPane } from "./panes/FilePreviewPane";
import { LibraryOverviewPane } from "./panes/LibraryOverviewPane";
import { CategoryDetailPane } from "./panes/CategoryDetailPane";

export function FileLibraryPage() {
  const { state, dispatch } = useChat();
  const { isAuthenticated } = useAuth();
  const { loadFileDocuments } = useChatHooks();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (state.fileCategories.length === 0) {
      listFileCategories()
        .then((cats) => dispatch({ type: "SET_FILE_CATEGORIES", payload: cats }))
        .catch(() => {});
    }
  }, [dispatch, isAuthenticated, state.fileCategories.length]);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadFileDocuments().catch((err) => {
      setLoadError(err instanceof Error ? err.message : "文件库加载失败");
    });
  }, [isAuthenticated, state.fileLibraryRevision, loadFileDocuments]);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col flex-1 h-full overflow-y-auto bg-background px-8 py-6">
        <div className="mx-auto flex min-h-[60vh] w-full max-w-[760px] items-center justify-center">
          <Surface variant="featured" className="relative w-full overflow-hidden rounded-[2rem] p-8 text-center">
            <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/12 blur-3xl" />
            <div className="relative mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-primary/10 text-primary ring-1 ring-primary/15">
              <Database className="w-7 h-7" />
            </div>
            <div className="relative mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-primary/80">
              File Library
            </div>
            <h1 className="relative text-3xl font-black tracking-[-0.04em] text-foreground">
              登录后查看文件库
            </h1>
            <p className="relative mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              登录后可查看和管理你的个人文件库，上传文档并用于写作与对话检索。
            </p>
            <Button
              className="relative mt-6 rounded-full shadow-lg shadow-primary/20"
              onClick={() => setLoginDialogOpen(true)}
            >
              登录到 AI Blog
            </Button>
          </Surface>
        </div>
        <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
      </div>
    );
  }

  if (loadError && state.fileDocuments.length === 0) {
    return (
      <div className="flex flex-col flex-1 h-full items-center justify-center bg-background p-8 text-center">
        <Alert variant="destructive" className="max-w-md">
          {loadError}
        </Alert>
        <Button
          variant="outline"
          className="mt-3 rounded-full"
          onClick={() => loadFileDocuments()}
        >
          重试
        </Button>
      </div>
    );
  }

  if (state.fileSelectedFile) {
    return <FilePreviewPane />;
  }

  if (state.fileSelectedCategoryId != null) {
    return <CategoryDetailPane categoryId={state.fileSelectedCategoryId} />;
  }

  return <LibraryOverviewPane />;
}
