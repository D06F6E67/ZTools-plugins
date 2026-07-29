import type { Page } from "@/types";
import { extractTitleFromContent } from "./content-text-extractor";

export function getPageTitle(page: Page): string {
  if (page.localFilePath) {
    // 本地文件：tab/侧栏用文件名（去 .md/.markdown 后缀），不取编辑器内的 H1——
    // 文件名与文档标题是两件独立的事。
    const name = page.localFilePath.split(/[\\/]/).pop() || "";
    const stripped = name.replace(/\.(md|markdown)$/i, "").trim();
    return stripped || "无标题";
  }

  return extractTitleFromContent(page.content);
}
