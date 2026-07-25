import { useChat } from "../../../stores/chatStore";
import { FilePreview } from "../components/FilePreview";

export function FilePreviewPane() {
  const { state } = useChat();

  if (!state.fileSelectedFile) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden bg-background px-2 py-2">
      <div className="flex w-full flex-1 min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-xl shadow-foreground/5">
        <FilePreview filename={state.fileSelectedFile} />
      </div>
    </div>
  );
}
