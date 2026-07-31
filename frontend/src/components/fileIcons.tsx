import pdfIcon from "@/components/icons/pdf.svg";
import docxIcon from "@/components/icons/docx.svg";
import xlsxIcon from "@/components/icons/xlsx.svg";
import jpgIcon from "@/components/icons/jpg.svg";
import unknownIcon from "@/components/icons/unknown.svg";

// 文件类型彩色图标：保留品牌原色（PDF 红 / Word 蓝 / Excel 绿 …），
// 作为 SVG 资源以 <img> 引用，尺寸随外层 className。
export function getFileIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  let src = unknownIcon;
  switch (ext) {
    case "pdf":
      src = pdfIcon;
      break;
    case "docx":
    case "doc":
      src = docxIcon;
      break;
    case "xlsx":
    case "xls":
      src = xlsxIcon;
      break;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "bmp":
      src = jpgIcon;
      break;
    default:
      src = unknownIcon;
  }
  return <img src={src} alt="" aria-hidden className="h-4 w-4 flex-shrink-0" />;
}
