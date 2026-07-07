import { Fragment } from "react";
import type { KBCategory } from "../../stores/chatStore";
import {
  Folder,
  ChevronRight,
  FolderPlus,
  Trash2,
  Upload,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import type { EditingState } from "./kbCategoryUtils";

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
  editingState,
  onEditingValueChange,
  onEditingSubmit,
  onEditingCancel,
  dragCategoryId,
  dropTargetId,
  onDragStart,
  onDragEnd,
  onDropOnCategory,
  onDropTargetChange,
  depth = 0,
}: {
  categories: KBCategory[];
  selectedId: number | null;
  expandedIds: Set<number>;
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
  onRequestDelete: (id: number, name: string) => void;
  onRequestNewSub: (parentId: number) => void;
  onRequestUpload: (id: number, name: string) => void;
  onRequestRename: (id: number, currentName: string) => void;
  editingState: EditingState | null;
  onEditingValueChange: (value: string) => void;
  onEditingSubmit: () => void;
  onEditingCancel: () => void;
  dragCategoryId: number | null;
  dropTargetId: number | null;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onDropOnCategory: (sourceId: number, targetId: number) => Promise<void>;
  onDropTargetChange: (id: number | null) => void;
  depth?: number;
}) {
  return categories.map((cat) => {
    const hasChildren = Boolean(cat.children?.length);
    const isExpanded = expandedIds.has(cat.id);
    const isRenaming =
      editingState?.type === "rename" && editingState.categoryId === cat.id;
    const showNewSubInput =
      editingState?.type === "newSub" && editingState.categoryId === cat.id;
    const isDropTarget = dropTargetId === cat.id;
    const isDragging = dragCategoryId === cat.id;

    return (
      <Fragment key={cat.id}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            {isRenaming ? (
              <div
                className="flex items-center"
                style={{ paddingLeft: 12 + depth * 16 }}
              >
                {hasChildren ? (
                  <ChevronRight
                    className={`w-3.5 h-3.5 flex-shrink-0 text-muted-foreground transition-transform mr-2 ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  />
                ) : (
                  <Folder className="w-4 h-4 flex-shrink-0 mr-2" />
                )}
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
                  className="h-7 text-[13px] px-2 py-1"
                  autoFocus
                />
              </div>
            ) : (
              <Button
                variant={selectedId === cat.id ? "secondary" : "ghost"}
                className={`justify-start text-[13px] px-3 py-2.5 rounded-xl h-auto font-medium gap-2 transition-all duration-150 hover:translate-x-0.5 hover:bg-primary/8 ${
                  selectedId === cat.id ? "bg-primary/10 text-primary shadow-sm" : ""
                } ${isDragging ? "opacity-40 scale-[0.98]" : ""} ${isDropTarget ? "ring-2 ring-primary/60 bg-primary/12 shadow-md shadow-primary/10" : ""}`}
                style={{ paddingLeft: 12 + depth * 16 }}
                onClick={() => {
                  onSelect(cat.id);
                  if (hasChildren) onToggle(cat.id);
                }}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.setData("text/plain", String(cat.id));
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
                  if (dragCategoryId && dragCategoryId !== cat.id) {
                    onDropTargetChange(cat.id);
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  if (dragCategoryId && dragCategoryId !== cat.id) {
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
                  const sourceId =
                    Number(e.dataTransfer.getData("text/plain")) || dragCategoryId;
                  if (sourceId && sourceId !== cat.id) {
                    await onDropOnCategory(sourceId, cat.id);
                  }
                  onDropTargetChange(null);
                }}
              >
                {hasChildren ? (
                  <ChevronRight
                    className={`w-3.5 h-3.5 flex-shrink-0 text-muted-foreground transition-transform ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  />
                ) : (
                  <Folder className="w-4 h-4 flex-shrink-0" />
                )}
                {cat.name}
              </Button>
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
        {hasChildren && isExpanded ? (
          <>
            {showNewSubInput && (
              <div
                className="flex items-center"
                style={{ paddingLeft: 12 + (depth + 1) * 16 }}
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
            <CategoryTree
              categories={cat.children ?? []}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
              onRequestDelete={onRequestDelete}
              onRequestNewSub={onRequestNewSub}
              onRequestUpload={onRequestUpload}
              onRequestRename={onRequestRename}
              editingState={editingState}
              onEditingValueChange={onEditingValueChange}
              onEditingSubmit={onEditingSubmit}
              onEditingCancel={onEditingCancel}
              dragCategoryId={dragCategoryId}
              dropTargetId={dropTargetId}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropOnCategory={onDropOnCategory}
              onDropTargetChange={onDropTargetChange}
              depth={depth + 1}
            />
          </>
        ) : showNewSubInput ? (
          <div
            className="flex items-center"
            style={{ paddingLeft: 12 + (depth + 1) * 16 }}
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
