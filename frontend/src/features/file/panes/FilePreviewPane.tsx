import { useChat } from "../../../stores/chatStore";
import { Surface } from "@/components/ui/surface";
import { FilePreview } from "../components/FilePreview";

export function FilePreviewPane() {
  const { state } = useChat();

  if (!state.fileSelectedFile) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden bg-background px-2 py-2">
      <Surface variant="card" className="flex w-full flex-1 min-h-0 flex-col overflow-hidden rounded-panel bg-card/90">
        <FilePreview filename={state.fileSelectedFile} />
      </Surface>
    </div>
  );
}
