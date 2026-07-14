import { FileText, FileSpreadsheet, File } from "lucide-react";
import type { FileCategory } from "../../../stores/chatStore";

export function flattenCategories(
  cats: FileCategory[],
  depth = 0,
): (FileCategory & { _depth: number })[] {
  const result: (FileCategory & { _depth: number })[] = [];
  for (const cat of cats) {
    result.push({ ...cat, _depth: depth });
    if (cat.children?.length) {
      result.push(...flattenCategories(cat.children, depth + 1));
    }
  }
  return result;
}

export function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

export function getDocumentIcon(fileName: string, className = "w-8 h-8") {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf"))
    return <FileText className={`${className} text-red-500`} />;
  if (lower.endsWith(".docx") || lower.endsWith(".doc"))
    return <FileText className={`${className} text-blue-500`} />;
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls"))
    return <FileSpreadsheet className={`${className} text-green-500`} />;
  return <File className={`${className} text-muted-foreground`} />;
}
