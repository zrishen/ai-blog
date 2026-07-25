import { useMemo } from "react";
import { useChat } from "../../../stores/chatStore";
import type { FileDocument } from "../../../stores/chatStore";
import {
  Database,
  Sparkles,
  FolderOpen,
  FileStack,
  Files,
  Folders,
} from "lucide-react";
import { formatDate, getDocumentIcon } from "./filePaneUtils";

export function LibraryOverviewPane() {
  const { state, dispatch } = useChat();

  const sortedDocuments = useMemo(() => {
    return [...state.fileDocuments].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [state.fileDocuments]);

  const uncategorizedCount = useMemo(
    () => sortedDocuments.filter((d) => d.category_id == null).length,
    [sortedDocuments],
  );
  const categorizedCount = state.fileDocuments.length - uncategorizedCount;
  const recentDocs = sortedDocuments.slice(0, 8);
  const flatCategoryCount = useMemo(
    () => countCategories(state.fileCategories),
    [state.fileCategories],
  );

  const handlePreview = (doc: FileDocument) => {
    dispatch({ type: "SET_FILE_SELECTED_FILE", payload: doc.file_path });
  };

  return (
    <div className="flex flex-col flex-1 h-full overflow-y-auto bg-background px-2 py-2">
      <div className="w-full flex flex-col flex-1 min-h-0">
        <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            icon={<Files className="w-4 h-4" />}
            label="总文件"
            value={state.fileDocuments.length}
          />
          <StatCard
            icon={<FileStack className="w-4 h-4" />}
            label="已分类"
            value={categorizedCount}
          />
          <StatCard
            icon={<FolderOpen className="w-4 h-4" />}
            label="未分类"
            value={uncategorizedCount}
          />
          <StatCard
            icon={<Folders className="w-4 h-4" />}
            label="分类数"
            value={flatCategoryCount}
          />
        </div>

        {state.fileDocuments.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-border/70 bg-card/86 p-10 text-center shadow-sm">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-primary/10 text-primary ring-1 ring-primary/15">
              <Sparkles className="w-7 h-7" />
            </div>
            <h2 className="text-2xl font-bold tracking-[-0.03em] text-foreground">
              暂无文件
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              在左侧栏「全部分类」上右键即可上传文件，或先新建一个分类。
            </p>
          </div>
        ) : (
          <SectionCard title="最近文件" icon={<Database className="w-4 h-4" />}>
            <div className="flex flex-col">
              {recentDocs.map((doc) => (
                <FileRow
                  key={doc.id}
                  doc={doc}
                  onPreview={() => handlePreview(doc)}
                />
              ))}
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}

function countCategories(categories: { children?: unknown }[]): number {
  let n = categories.length;
  for (const c of categories) {
    const children = (c as { children?: unknown[] }).children;
    if (children?.length) n += countCategories(children as { children?: unknown[] }[]);
  }
  return n;
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card/86 p-3 shadow-sm">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="text-lg font-bold text-foreground">{value}</div>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/86 shadow-sm">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5 text-[13px] font-semibold text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </div>
      <div className="flex-1 overflow-y-auto p-1">{children}</div>
    </div>
  );
}

interface FileRowProps {
  doc: FileDocument;
  onPreview: () => void;
}

function FileRow({ doc, onPreview }: FileRowProps) {
  return (
    <button
      type="button"
      onClick={onPreview}
      className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-secondary/60"
      title={doc.original_name}
    >
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary/80 ring-1 ring-border/70">
        {getDocumentIcon(doc.original_name, "w-5 h-5")}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-foreground">
          {doc.original_name}
        </div>
        <div className="text-[12px] text-muted-foreground">
          {doc.chunk_count} 个片段 · {formatDate(doc.created_at)}
        </div>
      </div>
    </button>
  );
}
