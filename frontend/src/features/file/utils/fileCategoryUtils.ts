import type { FileCategory, FileDocument } from "../../../stores/chatStore";

export type EditingState =
  | { type: "rename"; categoryId: number; value: string }
  | { type: "newSub"; categoryId: number; value: string }
  | { type: "renameFile"; docId: number; value: string };

export function isDescOf(targetId: number, ancestorId: number, tree: FileCategory[]): boolean {
  for (const cat of tree) {
    if (cat.id === ancestorId) {
      return containsId(targetId, cat.children ?? []);
    }
    if (isDescOf(targetId, ancestorId, cat.children ?? [])) return true;
  }
  return false;
}

function containsId(id: number, tree: FileCategory[]): boolean {
  for (const cat of tree) {
    if (cat.id === id) return true;
    if (containsId(id, cat.children ?? [])) return true;
  }
  return false;
}

export function findCategoryById(id: number, tree: FileCategory[]): FileCategory | null {
  for (const cat of tree) {
    if (cat.id === id) return cat;
    const child = findCategoryById(id, cat.children ?? []);
    if (child) return child;
  }
  return null;
}

interface GroupedDocuments {
  byCategoryId: Map<number, FileDocument[]>;
  uncategorized: FileDocument[];
}

export function groupByCategory(docs: FileDocument[]): GroupedDocuments {
  const byCategoryId = new Map<number, FileDocument[]>();
  const uncategorized: FileDocument[] = [];
  for (const doc of docs) {
    if (doc.category_id == null) {
      uncategorized.push(doc);
      continue;
    }
    const list = byCategoryId.get(doc.category_id);
    if (list) list.push(doc);
    else byCategoryId.set(doc.category_id, [doc]);
  }
  return { byCategoryId, uncategorized };
}

export function collectDescendantIds(id: number, tree: FileCategory[]): number[] {
  const ids: number[] = [];
  const walk = (nodes: FileCategory[]) => {
    for (const cat of nodes) {
      if (cat.id === id) {
        const collect = (sub: FileCategory) => {
          ids.push(sub.id);
          for (const child of sub.children ?? []) collect(child);
        };
        collect(cat);
        return true;
      }
      if (cat.children?.length && walk(cat.children)) return true;
    }
    return false;
  };
  walk(tree);
  return ids;
}

interface FlatCategory extends FileCategory {
  _depth: number;
}

export function flattenCategories(
  categories: FileCategory[],
  depth = 0,
): FlatCategory[] {
  const result: FlatCategory[] = [];
  for (const c of categories) {
    result.push({ ...c, _depth: depth });
    if (c.children?.length) {
      result.push(...flattenCategories(c.children, depth + 1));
    }
  }
  return result;
}
