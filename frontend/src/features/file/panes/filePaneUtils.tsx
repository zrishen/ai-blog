import pdfIcon from "@/components/icons/pdf.svg";
import docxIcon from "@/components/icons/docx.svg";
import xlsxIcon from "@/components/icons/xlsx.svg";
import jpgIcon from "@/components/icons/jpg.svg";
import unknownIcon from "@/components/icons/unknown.svg";

export function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

// 文件类型彩色图标：保留品牌原色，SVG 资源引用；尺寸由 className 控制（默认 32px）
export function getDocumentIcon(fileName: string, className = "w-8 h-8") {
  const lower = fileName.toLowerCase();
  let src = unknownIcon;
  if (lower.endsWith(".pdf")) src = pdfIcon;
  else if (lower.endsWith(".docx") || lower.endsWith(".doc")) src = docxIcon;
  else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) src = xlsxIcon;
  else if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) src = jpgIcon;
  return <img src={src} alt="" aria-hidden className={className} />;
}
