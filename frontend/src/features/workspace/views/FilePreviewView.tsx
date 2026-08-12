import { useChat } from "../../../stores/chatStore";

import { SubPageHeader, WorkspaceView } from "./shared";

import { FilePreview } from "../components/FilePreview";

/** 工作区内联文件预览：复用文件库的 FilePreview，顶部加返回（清 fileSelectedFile）。 */
export function FilePreviewView({ onBack }: { onBack: () => void }) {
  const { state } = useChat();
  if (!state.fileSelectedFile) return null;
  return (
    <WorkspaceView header={<SubPageHeader onBack={onBack} />}>
      <div className="flex min-h-0 flex-1 flex-col">
        <FilePreview filename={state.fileSelectedFile} />
      </div>
    </WorkspaceView>
  );
}
