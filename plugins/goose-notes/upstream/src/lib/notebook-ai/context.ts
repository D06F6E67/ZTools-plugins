import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { useTabs } from "@/stores/useTabs";
import {
  buildAiFileReferenceAttrs,
  formatAiReferenceContextBlock,
  getAiReferenceSuggestionItems,
  resolveAiReferenceContexts,
  type AiComposerPayload,
  type AiFileReferenceAttrs,
  type AiReferenceSuggestionItem,
} from "@/components/editor/ai/composer/referenceLookup";
import type { NotebookAiMessageMetadata } from "./types";

function dedupeReferences(references: AiFileReferenceAttrs[]) {
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (!reference.pageId || seen.has(reference.pageId)) return false;
    seen.add(reference.pageId);
    return true;
  });
}

export function getCurrentNotebookAiPageId(notebookId: string): string | null {
  const pages = usePages.getState().pages;
  const { openTabs, activeTabId } = useTabs.getState();
  const activeTab = openTabs.find((tab) => tab.id === activeTabId);
  const tabPageId = activeTab?.type === "welcome" ? null : activeTab?.pageId;
  const fallbackPageId = usePages.getState().activePageId;
  const candidates = [tabPageId, fallbackPageId].filter(Boolean) as string[];

  for (const pageId of candidates) {
    const page = pages[pageId];
    if (
      !page ||
      page.workspaceId !== notebookId ||
      page.trashedAt ||
      page.isFolder
    ) {
      continue;
    }
    return page.id;
  }

  return null;
}

export function getNotebookAiReferenceSuggestions(
  query: string,
  notebookId: string,
): AiReferenceSuggestionItem[] {
  const { pages } = usePages.getState();
  const { notebooks } = useNotebooks.getState();
  return getAiReferenceSuggestionItems(query, pages, notebooks, notebookId, {
    notebookId,
  }).filter((item) => !item.isFolder);
}

function resolveContextBlock(references: AiFileReferenceAttrs[]) {
  if (references.length === 0) return "";
  return formatAiReferenceContextBlock(
    resolveAiReferenceContexts(
      references,
      usePages.getState().pages,
      useNotebooks.getState().notebooks,
    ),
  );
}

function getImplicitPage(notebookId: string, currentPageId?: string | null) {
  if (!currentPageId) return undefined;
  const page = usePages.getState().pages[currentPageId];
  if (
    !page ||
    page.workspaceId !== notebookId ||
    page.trashedAt ||
    page.isFolder
  ) {
    return undefined;
  }
  return buildAiFileReferenceAttrs(page, useNotebooks.getState().notebooks);
}

export function buildNotebookAiUserMessage(params: {
  payload: AiComposerPayload;
  notebookId: string;
  currentPageId?: string | null;
  /**
   * AI 面板会把当前笔记作为显式、可移除的上下文项传入；移除后不能再
   * 回退为隐式当前页，否则用户无法发起完全脱离笔记的提问。
   */
  useImplicitPage?: boolean;
}): {
  modelText: string;
  metadata: NotebookAiMessageMetadata;
  currentPageId: string | null;
} {
  const currentPageId =
    params.currentPageId ?? getCurrentNotebookAiPageId(params.notebookId);
  const references = dedupeReferences(params.payload.references);
  const implicitPage =
    params.useImplicitPage !== false && references.length === 0
      ? getImplicitPage(params.notebookId, currentPageId)
      : undefined;
  const contextReferences =
    references.length > 0 ? references : implicitPage ? [implicitPage] : [];
  const contextBlock = resolveContextBlock(contextReferences);
  const contextIntro =
    references.length > 0
      ? "用户为本轮选择了以下笔记作为上下文。请优先基于这些内容回答，并根据用户指令确定需要读取或修改的目标。"
      : implicitPage
        ? "用户没有 @ 其它笔记。默认把当前活动页签对应的笔记作为本轮关联页面；“当前页 / 本文 / 这篇”都指向该页面。"
        : "";
  const displayText = params.payload.promptText.trim();
  const modelText = [
    "用户输入：",
    displayText,
    contextBlock
      ? [
          "本轮笔记上下文：",
          contextIntro,
          contextBlock,
          implicitPage
            ? `默认工具目标 pageId：${implicitPage.pageId}。readPage、updatePage、replaceInPage、appendToPage、renamePage 省略 pageId 时应操作这个页面。`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    modelText,
    currentPageId,
    metadata: {
      displayText,
      references: references.length > 0 ? references : undefined,
      implicitPage,
    },
  };
}
