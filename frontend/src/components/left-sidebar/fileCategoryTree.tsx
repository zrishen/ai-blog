import { Fragment } from "react";
import type { FileCategory, FileDocument } from "../../stores/chatStore";
import {
  Folder,
  ChevronRight,
  FolderPlus,
  Trash2,
  Upload,
  Pencil,
  Move,
  Eye,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import type { EditingState } from "./fileCategoryUtils";
import { getFileIcon } from "./fileIcons";

export interface CategoryTreeProps {
  categories: FileCategory[];
  selectedId: number | null;
  expandedIds: Set<string | number>;
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
  onRequestDelete: (id: number, name: string) => void;
  onRequestNewSub: (parentId: number) => void;
  onRequestUpload: (id: number, name: string) => void;
  onRequestRename: (id: number, currentName: string) => void;
  onRequestMove: (id: number, name: string) => void;
  onRequestFileDelete: (doc: FileDocument) => void;
  onRequestFileMove: (doc: FileDocument) => void;
  onRequestFileRename: (doc: FileDocument) => void;
  editingState: EditingState | null;
  onEditingValueChange: (value: string) => void;
  onEditingSubmit: () => void;
  onEditingCancel: () => void;
  dragCategoryId: number | null;
  dropTargetId: number | null;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onDropOnCategory: (sourceId: number, targetId: number) => Promise<void>;
  onDropFileOnCategory: (fileId: number, targetId: number) => Promise<void>;
  onDropTargetChange: (id: number | null) => void;
  documentsByCategory?: Map<number, FileDocument[]>;
  selectedFile?: string | null;
  onSelectFile?: (filePath: string) => void;
  depth?: number;
}

export function CategoryTree({
  categories,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
  onRequestDelete,
  onRequestNewSub,
  onRequestUpload,
  onRequestRename,
  onRequestMove,
  onRequestFileDelete,
  onRequestFileMove,
  onRequestFileRename,
  editingState,
  onEditingValueChange,
  onEditingSubmit,
  onEditingCancel,
  dragCategoryId,
  dropTargetId,
  onDragStart,
  onDragEnd,
  onDropOnCategory,
  onDropFileOnCategory,
  onDropTargetChange,
  documentsByCategory,
  selectedFile,
  onSelectFile,
  depth = 0,
}: CategoryTreeProps) {
  return categories.map((cat) => {
    const isExpanded = expandedIds.has(cat.id);
    const isRenaming =
      editingState?.type === "rename" && editingState.categoryId === cat.id;
    const showNewSubInput =
      editingState?.type === "newSub" && editingState.categoryId === cat.id;
    const isDropTarget = dropTargetId === cat.id;
    const isDragging = dragCategoryId === cat.id;
    const docsForCat = documentsByCategory?.get(cat.id) ?? [];
    const showDocs = isExpanded && docsForCat.length > 0 && onSelectFile;
    const isSelected = selectedId === cat.id;
    const indent = 8 + depth * 16;

    return (
      <Fragment key={cat.id}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            {isRenaming ? (
              <div
                role="treeitem"
                aria-expanded={isExpanded}
                aria-selected={isSelected}
                className={`group flex items-center gap-0.5 rounded-xl py-1 pr-2 ${
                  isSelected
                    ? "bg-primary/10 text-primary shadow-sm"
                    : "text-foreground"
                }`}
                style={{ paddingLeft: indent }}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(cat.id);
                  }}
                  className="flex-shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label={isExpanded ? "折叠分类" : "展开分类"}
                  tabIndex={-1}
                >
                  <ChevronRight
                    className={`w-3.5 h-3.5 transition-transform ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  />
                </button>
                <div className="flex flex-1 min-w-0 items-center gap-2 px-1.5 py-1.5">
                  <Folder
                    className={`w-4 h-4 flex-shrink-0 ${
                      isSelected ? "text-primary" : "text-muted-foreground"
                    }`}
                  />
                  <Input
                    value={editingState.value}
                    onChange={(e) => onEditingValueChange(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") onEditingSubmit();
                      if (e.key === "Escape") onEditingCancel();
                    }}
                    onBlur={() => {
                      if (editingState.value.trim()) {
                        onEditingSubmit();
                      } else {
                        onEditingCancel();
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-[19px] flex-1 min-w-0 rounded-md border border-input bg-card px-1.5 py-0 text-[13px] font-medium leading-tight"
                    autoFocus
                  />
                </div>
              </div>
            ) : (
              <div
                role="treeitem"
                aria-expanded={isExpanded}
                aria-selected={isSelected}
                className={`group flex items-center gap-0.5 rounded-xl py-1 pr-2 transition-all duration-150 ${
                  isSelected
                    ? "bg-primary/10 text-primary shadow-sm"
                    : "text-foreground hover:bg-primary/8"
                } ${isDragging ? "opacity-40 scale-[0.98]" : ""} ${
                  isDropTarget
                    ? "relative z-20 ring-2 ring-inset ring-primary/60 bg-primary/12 shadow-md shadow-primary/10"
                    : ""
                }`}
                style={{ paddingLeft: indent }}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.setData("text/plain", `cat:${cat.id}`);
                  e.dataTransfer.effectAllowed = "move";
                  onDragStart(cat.id);
                }}
                onDragEnd={(e) => {
                  e.stopPropagation();
                  onDragEnd();
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (dragCategoryId !== cat.id) {
                    onDropTargetChange(cat.id);
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  if (dragCategoryId !== cat.id) {
                    onDropTargetChange(cat.id);
                  }
                }}
                onDragLeave={(e) => {
                  e.stopPropagation();
                  const nextTarget = e.relatedTarget as Node | null;
                  if (!nextTarget || !e.currentTarget.contains(nextTarget)) {
                    onDropTargetChange(null);
                  }
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const raw = e.dataTransfer.getData("text/plain");
                  const source = parseDragSource(raw);
                  if (!source) {
                    onDropTargetChange(null);
                    return;
                  }
                  if (source.kind === "file") {
                    await onDropFileOnCategory(source.id, cat.id);
                  } else if (source.kind === "cat" && source.id !== cat.id) {
                    await onDropOnCategory(source.id, cat.id);
                  }
                  onDropTargetChange(null);
                }}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(cat.id);
                  }}
                  className="flex-shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label={isExpanded ? "折叠分类" : "展开分类"}
                  tabIndex={-1}
                >
                  <ChevronRight
                    className={`w-3.5 h-3.5 transition-transform ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => onSelect(cat.id)}
                  className="flex flex-1 min-w-0 items-center gap-2 px-1.5 py-1.5 text-left text-[13px] font-medium"
                  tabIndex={-1}
                >
                  <Folder
                    className={`w-4 h-4 flex-shrink-0 ${
                      isSelected ? "text-primary" : "text-muted-foreground"
                    }`}
                  />
                  <span className="flex-1 truncate">{cat.name}</span>
                  {docsForCat.length > 0 && (
                    <span className="ml-auto pl-2 text-[11px] text-muted-foreground">
                      {docsForCat.length}
                    </span>
                  )}
                </button>
              </div>
            )}
          </ContextMenuTrigger>
          <ContextMenuContent className="w-44">
            <ContextMenuItem onClick={() => onRequestNewSub(cat.id)}>
              <FolderPlus className="w-4 h-4" />
              新建子分类
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onRequestUpload(cat.id, cat.name)}>
              <Upload className="w-4 h-4" />
              上传文件
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onRequestMove(cat.id, cat.name)}>
              <Move className="w-4 h-4" />
              移动
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onRequestRename(cat.id, cat.name)}>
              <Pencil className="w-4 h-4" />
              重命名
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() => onRequestDelete(cat.id, cat.name)}
            >
              <Trash2 className="w-4 h-4" />
              删除分类
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {isExpanded ? (
          <>
            {showNewSubInput && (
              <div
                className="flex items-center"
                style={{ paddingLeft: 8 + (depth + 1) * 16 }}
              >
                <Folder className="w-4 h-4 flex-shrink-0 mr-2" />
                <Input
                  value={editingState!.value}
                  onChange={(e) => onEditingValueChange(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") onEditingSubmit();
                    if (e.key === "Escape") onEditingCancel();
                  }}
                  onBlur={() => {
                    if (editingState!.value.trim()) {
                      onEditingSubmit();
                    } else {
                      onEditingCancel();
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="h-7 text-[13px] px-2 py-1"
                  autoFocus
                  placeholder="输入分类名称"
                />
              </div>
            )}
            {cat.children && cat.children.length > 0 && (
              <CategoryTree
                categories={cat.children}
                selectedId={selectedId}
                expandedIds={expandedIds}
                onSelect={onSelect}
                onToggle={onToggle}
                onRequestDelete={onRequestDelete}
                onRequestNewSub={onRequestNewSub}
                onRequestUpload={onRequestUpload}
                onRequestRename={onRequestRename}
                onRequestMove={onRequestMove}
                onRequestFileDelete={onRequestFileDelete}
                onRequestFileMove={onRequestFileMove}
                onRequestFileRename={onRequestFileRename}
                editingState={editingState}
                onEditingValueChange={onEditingValueChange}
                onEditingSubmit={onEditingSubmit}
                onEditingCancel={onEditingCancel}
                dragCategoryId={dragCategoryId}
                dropTargetId={dropTargetId}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDropOnCategory={onDropOnCategory}
                onDropFileOnCategory={onDropFileOnCategory}
                onDropTargetChange={onDropTargetChange}
                documentsByCategory={documentsByCategory}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                depth={depth + 1}
              />
            )}
            {showDocs &&
              docsForCat.map((doc) => (
                <FileNode
                  key={`doc-${doc.id}`}
                  doc={doc}
                  depth={depth}
                  selectedFile={selectedFile}
                  onSelectFile={onSelectFile!}
                  onRequestDelete={onRequestFileDelete}
                  onRequestMove={onRequestFileMove}
                  onRequestRename={onRequestFileRename}
                  editingState={editingState}
                  onEditingValueChange={onEditingValueChange}
                  onEditingSubmit={onEditingSubmit}
                  onEditingCancel={onEditingCancel}
                />
              ))}
          </>
        ) : showNewSubInput ? (
          <div
            className="flex items-center"
            style={{ paddingLeft: 8 + (depth + 1) * 16 }}
          >
            <Folder className="w-4 h-4 flex-shrink-0 mr-2" />
            <Input
              value={editingState!.value}
              onChange={(e) => onEditingValueChange(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") onEditingSubmit();
                if (e.key === "Escape") onEditingCancel();
              }}
              onBlur={() => {
                if (editingState!.value.trim()) {
                  onEditingSubmit();
                } else {
                  onEditingCancel();
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-7 text-[13px] px-2 py-1"
              autoFocus
              placeholder="输入分类名称"
            />
          </div>
        ) : null}
      </Fragment>
    );
  });
}

interface FileNodeProps {
  doc: FileDocument;
  depth: number;
  selectedFile?: string | null;
  onSelectFile: (filePath: string) => void;
  onRequestDelete: (doc: FileDocument) => void;
  onRequestMove: (doc: FileDocument) => void;
  onRequestRename: (doc: FileDocument) => void;
  editingState: EditingState | null;
  onEditingValueChange: (value: string) => void;
  onEditingSubmit: () => void;
  onEditingCancel: () => void;
}

export function FileNode({
  doc,
  depth,
  selectedFile,
  onSelectFile,
  onRequestDelete,
  onRequestMove,
  onRequestRename,
  editingState,
  onEditingValueChange,
  onEditingSubmit,
  onEditingCancel,
}: FileNodeProps) {
  const isDocSelected = selectedFile === doc.file_path;
  const isRenaming =
    editingState?.type === "renameFile" && editingState.docId === doc.id;
  const indent = 8 + (depth + 1) * 16;

  if (isRenaming && editingState?.type === "renameFile") {
    return (
      <div
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 ${
          isDocSelected ? "bg-primary/10" : ""
        }`}
        style={{ paddingLeft: indent }}
      >
        <span className="flex-shrink-0">{getFileIcon(doc.original_name)}</span>
        <Input
          value={editingState.value}
          onChange={(e) => onEditingValueChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") onEditingSubmit();
            if (e.key === "Escape") onEditingCancel();
          }}
          onBlur={() => {
            if (editingState.value.trim()) onEditingSubmit();
            else onEditingCancel();
          }}
          onClick={(e) => e.stopPropagation()}
          className="h-[19px] flex-1 min-w-0 rounded-md border border-input bg-card px-1.5 py-0 text-[13px] leading-tight"
          autoFocus
        />
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.setData("text/plain", `file:${doc.id}`);
            e.dataTransfer.effectAllowed = "move";
          }}
          onClick={() => onSelectFile(doc.file_path)}
          className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
            isDocSelected
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`}
          style={{ paddingLeft: indent }}
          title={doc.original_name}
        >
          <span className="flex-shrink-0">{getFileIcon(doc.original_name)}</span>
          <span className="flex-1 truncate">{doc.original_name}</span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={() => onSelectFile(doc.file_path)}>
          <Eye className="w-4 h-4" />
          预览
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onRequestMove(doc)}>
          <Move className="w-4 h-4" />
          移动
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onRequestRename(doc)}>
          <Pencil className="w-4 h-4" />
          重命名
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => onRequestDelete(doc)}
        >
          <Trash2 className="w-4 h-4" />
          删除文件
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function parseDragSource(
  data: string,
): { kind: "cat" | "file"; id: number } | null {
  if (!data) return null;
  if (data.startsWith("cat:")) {
    const id = Number(data.slice(4));
    return Number.isFinite(id) && id > 0 ? { kind: "cat", id } : null;
  }
  if (data.startsWith("file:")) {
    const id = Number(data.slice(5));
    return Number.isFinite(id) && id > 0 ? { kind: "file", id } : null;
  }
  const legacyId = Number(data);
  return Number.isFinite(legacyId) && legacyId > 0
    ? { kind: "cat", id: legacyId }
    : null;
}
