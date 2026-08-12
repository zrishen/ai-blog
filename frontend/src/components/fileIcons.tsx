import pdfIcon from "@/components/icons/pdf.svg";
import docxIcon from "@/components/icons/docx.svg";
import xlsxIcon from "@/components/icons/xlsx.svg";
import jpgIcon from "@/components/icons/jpg.svg";
import unknownIcon from "@/components/icons/unknown.svg";

import type { JSX } from "react";

// svg 资源经 vite 注入，类型为 string；显式断言避免 eslint 对默认导入的 any 误判
const pdf: string = pdfIcon as string;
const docx: string = docxIcon as string;
const xlsx: string = xlsxIcon as string;
const jpg: string = jpgIcon as string;
const unknown: string = unknownIcon as string;

// 文件类型彩色图标：保留品牌原色（PDF 红 / Word 蓝 / Excel 绿 …），
// 作为 SVG 资源以 <img> 引用，尺寸随外层 className。
export function getFileIcon(fileName: string): JSX.Element {
  const ext = fileName.split(".").pop()?.toLowerCase();
  let src: string = unknown;
  switch (ext) {
    case "pdf":
      src = pdf;
      break;
    case "docx":
    case "doc":
      src = docx;
      break;
    case "xlsx":
    case "xls":
      src = xlsx;
      break;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "bmp":
      src = jpg;
      break;
    default:
      src = unknown;
  }
  return <img src={src} alt="" aria-hidden className="h-4 w-4 flex-shrink-0" />;
}
