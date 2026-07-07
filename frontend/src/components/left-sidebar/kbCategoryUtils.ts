import type { KBCategory } from "../../stores/chatStore";

export interface EditingState {
  type: "rename" | "newSub";
  categoryId: number;
  value: string;
}

export function isDescOf(targetId: number, ancestorId: number, tree: KBCategory[]): boolean {
  for (const cat of tree) {
    if (cat.id === ancestorId) {
      return containsId(targetId, cat.children ?? []);
    }
    if (isDescOf(targetId, ancestorId, cat.children ?? [])) return true;
  }
  return false;
}

export function containsId(id: number, tree: KBCategory[]): boolean {
  for (const cat of tree) {
    if (cat.id === id) return true;
    if (containsId(id, cat.children ?? [])) return true;
  }
  return false;
}

export function findCategoryById(id: number, tree: KBCategory[]): KBCategory | null {
  for (const cat of tree) {
    if (cat.id === id) return cat;
    const child = findCategoryById(id, cat.children ?? []);
    if (child) return child;
  }
  return null;
}
