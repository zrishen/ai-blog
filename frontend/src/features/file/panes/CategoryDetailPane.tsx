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
import { Surface } from "@/components/ui/surface";
import {
  collectDescendantIds,
  findCategoryById,
} from "../utils/fileCategoryUtils";
import { formatDate, getDocumentIcon } from "./filePaneUtils";

interface CategoryDetailPaneProps {
  categoryId: number;
}

export function CategoryDetailPane({ categoryId }: CategoryDetailPaneProps) {
  const { state, dispatch } = useChat();

  const category = useMemo(
    () => findCategoryById(categoryId, state.fileCategories),
    [categoryId, state.fileCategories],
  );

  const descendantIds = useMemo(
    () => new Set(collectDescendantIds(categoryId, state.fileCategories)),
    [categoryId, state.fileCategories],
  );

  const aggregatedDocs = useMemo(
    () =>
      state.fileDocuments.filter((d) => d.category_id != null && descendantIds.has(d.category_id)),
    [state.fileDocuments, descendantIds],
  );

  const directDocs = useMemo(
    () => state.fileDocuments.filter((d) => d.category_id === categoryId),
    [state.fileDocuments, categoryId],
  );

  const sortedAggregated = useMemo(
    () =>
      [...aggregatedDocs].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [aggregatedDocs],
  );
  const recentDocs = sortedAggregated.slice(0, 8);

  const descendantCategoryCount = descendantIds.size - 1;
  const directChildCount = useMemo(() => {
    const direct = findCategoryById(categoryId, state.fileCategories);
    return direct?.children?.length ?? 0;
  }, [categoryId, state.fileCategories]);

  if (!category) {
    return (
      <div className="flex flex-col flex-1 h-full items-center justify-center bg-background p-8 text-center text-sm text-muted-foreground">
        分类不存在或已被删除。
      </div>
    );
  }

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
            value={aggregatedDocs.length}
          />
          <StatCard
            icon={<FileStack className="w-4 h-4" />}
            label="直系文件"
            value={directDocs.length}
          />
          <StatCard
            icon={<FolderOpen className="w-4 h-4" />}
            label="子分类"
            value={directChildCount}
          />
          <StatCard
            icon={<Folders className="w-4 h-4" />}
            label="后代分类"
            value={descendantCategoryCount}
          />
        </div>

        {aggregatedDocs.length === 0 ? (
          <Surface variant="card" className="flex flex-1 flex-col items-center justify-center rounded-panel p-10 text-center shadow-sm">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-panel bg-primary/10 text-primary ring-1 ring-primary/15">
              <Sparkles className="w-7 h-7" />
            </div>
            <h2 className="text-2xl font-bold tracking-[-0.03em] text-foreground">
              暂无文件
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              在左侧栏该分类上右键即可上传文件，或新建子分类。
            </p>
          </Surface>
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
    <Surface variant="card" className="flex items-center gap-3 rounded-panel p-3 shadow-sm">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="text-lg font-bold text-foreground">{value}</div>
      </div>
    </Surface>
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
    <Surface variant="card" className="flex flex-1 flex-col overflow-hidden rounded-panel shadow-sm">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5 text-[13px] font-semibold text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </div>
      <div className="flex-1 overflow-y-auto p-1">{children}</div>
    </Surface>
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
