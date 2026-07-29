import {
  loadPagesFromStorage,
  saveInternalPage,
} from "@/lib/storage/pageRepository";
import { getDbStorageItem, setDbStorageItem } from "@/lib/storage/utoolsDbStorage";

import type { PagesState } from "../types";
import {
  LEGACY_TITLE_CHILDREN_REPAIR_MARK_KEY,
  NESTED_EMPTY_WRAPPER_REPAIR_MARK_KEY,
} from "../types";
import { isLocalFolderPage, seedLocalPageMetadataCache } from "../persistence";
import {
  repairLegacyTitleChildrenInPages,
  repairNormalizedContentInPages,
} from "../migrations";

export type StoreSet = (
  fn: Partial<PagesState> | ((state: PagesState) => Partial<PagesState>),
) => void;
export type StoreGet = () => PagesState;

export const hydrateFromStorageAction = async (set: StoreSet) => {
  const { pages, localPageMetas, onboardingCompleted } =
    loadPagesFromStorage();
  const hasRepairedLegacyTitleChildren =
    getDbStorageItem(LEGACY_TITLE_CHILDREN_REPAIR_MARK_KEY) === "1";
  const { pages: repairedPages, repairedPageIds } = hasRepairedLegacyTitleChildren
    ? { pages, repairedPageIds: [] as string[] }
    : repairLegacyTitleChildrenInPages(pages);
  const hasRepairedNestedEmptyWrappers =
    getDbStorageItem(NESTED_EMPTY_WRAPPER_REPAIR_MARK_KEY) === "1";
  const {
    pages: contentRepairedPages,
    repairedPageIds: contentRepairedPageIds,
  } = hasRepairedNestedEmptyWrappers
    ? { pages: repairedPages, repairedPageIds: [] as string[] }
    : repairNormalizedContentInPages(repairedPages);

  if (!hasRepairedLegacyTitleChildren) {
    if (repairedPageIds.length > 0) {
      repairedPageIds.forEach((pageId) => {
        const repairedPage = contentRepairedPages[pageId];
        if (!repairedPage || repairedPage.localFilePath) return;
        saveInternalPage(repairedPage);
      });
      console.info(
        `[usePages] repaired legacy title-children structure in ${repairedPageIds.length} page(s).`,
      );
    }
    setDbStorageItem(LEGACY_TITLE_CHILDREN_REPAIR_MARK_KEY, "1");
  }

  if (!hasRepairedNestedEmptyWrappers) {
    if (contentRepairedPageIds.length > 0) {
      contentRepairedPageIds.forEach((pageId) => {
        const repairedPage = contentRepairedPages[pageId];
        if (!repairedPage || isLocalFolderPage(repairedPage)) return;
        saveInternalPage(repairedPage);
      });
      console.info(
        `[usePages] repaired nested empty wrapper content in ${contentRepairedPageIds.length} page(s).`,
      );
    }
    setDbStorageItem(NESTED_EMPTY_WRAPPER_REPAIR_MARK_KEY, "1");
  }

  seedLocalPageMetadataCache(localPageMetas);
  set({
    pages: contentRepairedPages,
    activePageId: null,
    pendingNavigatePageId: null,
    expandPageId: null,
    searchHighlightQuery: null,
    searchHighlightPageId: null,
    searchHighlightNonce: 0,
    handledSearchHighlightNonce: 0,
    hydrated: true,
    lastSavedAt: null,
    onboardingCompleted,
  });
};
