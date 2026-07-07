import { FileText, FileSpreadsheet, FileImage, File } from "lucide-react";

export function getFileIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return <FileText className="w-4 h-4 flex-shrink-0 text-red-500" />;
    case "docx":
    case "doc":
      return <FileText className="w-4 h-4 flex-shrink-0 text-blue-500" />;
    case "xlsx":
    case "xls":
      return (
        <FileSpreadsheet className="w-4 h-4 flex-shrink-0 text-green-500" />
      );
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
      return <FileImage className="w-4 h-4 flex-shrink-0 text-purple-500" />;
    default:
      return (
        <File className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
      );
  }
}

export function researchStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    researching: "研究中",
    reviewing: "待审核",
    ready: "已确认",
    stale: "可能过期",
    archived: "已归档",
  };
  return labels[status] ?? status;
}
