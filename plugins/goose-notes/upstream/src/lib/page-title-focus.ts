const FOCUS_PAGE_TITLE_EVENT = "goose-note:focus-page-title";

let pendingPageId: string | null = null;

export function requestPageTitleFocus(pageId: string) {
  pendingPageId = pageId;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(FOCUS_PAGE_TITLE_EVENT, { detail: { pageId } }),
    );
  }
}

export function isPageTitleFocusRequested(pageId: string): boolean {
  return pendingPageId === pageId;
}

export function completePageTitleFocus(pageId: string) {
  if (pendingPageId === pageId) pendingPageId = null;
}

export function subscribePageTitleFocus(
  listener: (pageId: string) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handle = (event: Event) => {
    const pageId = (event as CustomEvent<{ pageId?: string }>).detail?.pageId;
    if (pageId) listener(pageId);
  };
  window.addEventListener(FOCUS_PAGE_TITLE_EVENT, handle);
  return () => window.removeEventListener(FOCUS_PAGE_TITLE_EVENT, handle);
}
