import { ChevronRight, FileText, Folder } from "lucide-react";

import type { WorkspaceEntry } from "@/api/workspace";
import { EmptyState } from "@/components/ui/empty-state";
import { useChat } from "../../../stores/chatStore";
import { SubPageHeader, WorkspaceView } from "./shared";

function parentPath(path: string): string | null {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? null : path.slice(0, separator);
}

function entryIcon(entry: WorkspaceEntry) {
  return entry.kind === "folder" ? (
    <Folder className="h-4 w-4 flex-shrink-0 text-primary" />
  ) : (
    <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
  );
}

export function FolderView({
  folderPath,
  onOpenBlog,
  onOpenFile,
  onBack,
}: {
  folderPath: string;
  onOpenBlog: (id: number) => void;
  onOpenFile: (filePath: string) => void;
  onBack: () => void;
}) {
  const { state, dispatch } = useChat();
  const entries = state.workspaceTree
    .filter((entry) => parentPath(entry.path) === folderPath)
    .sort((left, right) => {
      if (left.kind === "folder" && right.kind !== "folder") return -1;
      if (left.kind !== "folder" && right.kind === "folder") return 1;
      return left.name.localeCompare(right.name, "zh-CN");
    });

  const openEntry = (entry: WorkspaceEntry) => {
    if (entry.kind === "folder") {
      dispatch({ type: "SET_WORKSPACE_SELECTED_FOLDER_PATH", payload: entry.path });
    } else if (entry.kind === "blog" && entry.resource_id != null) {
      onOpenBlog(entry.resource_id);
    } else {
      onOpenFile(entry.path);
    }
  };

  return (
    <WorkspaceView header={<SubPageHeader onBack={onBack} />}>
      {entries.length === 0 ? (
        <EmptyState
          icon={Folder}
          title="这里还没有内容"
          description="可在左侧新建子文件夹、上传文件，或拖入已有内容。"
          className="flex-1 p-10"
        />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <ul className="flex flex-col">
            {entries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => openEntry(entry)}
                  className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-secondary/60"
                >
                  {entryIcon(entry)}
                  <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">{entry.name}</span>
                  {entry.kind === "blog" && (
                    <span className="text-fine text-muted-foreground">{entry.blog_status === "published" ? "已发布" : "草稿"}</span>
                  )}
                  {entry.kind === "folder" && <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WorkspaceView>
  );
}
