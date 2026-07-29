import { expect, test } from "playwright/test";
import type { JSONContent } from "../../src/types";
import type { PagesState } from "../../src/stores/pages/types";
import {
  clearLocalSaveTimers,
  discardPendingLocalSave,
  flushAllPendingLocalSavesInternal,
  flushPendingLocalSaveByPageIdInternal,
  localSaveDebounceTimers,
  localSaveMaxWaitTimers,
  localSaveWriteChains,
  pendingLocalSaveContents,
  queueLocalPageSave,
} from "../../src/stores/pages/folderSync";

const PAGE_ID = "local-page";

function content(text: string): JSONContent {
  return [{ type: "paragraph", content: text }] as unknown as JSONContent;
}

function stateWithSave(
  saveLocalPageContent: PagesState["saveLocalPageContent"],
): () => PagesState {
  return () => ({ saveLocalPageContent }) as unknown as PagesState;
}

function resetFolderSyncState() {
  for (const pageId of new Set([
    ...localSaveDebounceTimers.keys(),
    ...localSaveMaxWaitTimers.keys(),
  ])) {
    clearLocalSaveTimers(pageId);
  }
  pendingLocalSaveContents.clear();
  localSaveWriteChains.clear();
}

test.beforeEach(resetFolderSyncState);
test.afterEach(resetFolderSyncState);

test("false save result keeps pending content and rejects explicit flush", async () => {
  const draft = content("not-yet-saved");
  pendingLocalSaveContents.set(PAGE_ID, draft);

  await expect(
    flushPendingLocalSaveByPageIdInternal(
      PAGE_ID,
      stateWithSave(async () => false),
    ),
  ).rejects.toThrow(`本地页面保存未完成：${PAGE_ID}`);

  expect(pendingLocalSaveContents.get(PAGE_ID)).toBe(draft);
  expect(localSaveWriteChains.has(PAGE_ID)).toBe(false);
});

test("failed save does not overwrite newer content queued during the write", async () => {
  const first = content("first");
  const newer = content("newer");
  pendingLocalSaveContents.set(PAGE_ID, first);

  await expect(
    flushPendingLocalSaveByPageIdInternal(
      PAGE_ID,
      stateWithSave(async () => {
        pendingLocalSaveContents.set(PAGE_ID, newer);
        return false;
      }),
    ),
  ).rejects.toThrow();

  expect(pendingLocalSaveContents.get(PAGE_ID)).toBe(newer);
});

test("a later explicit flush retries and clears content kept after failure", async () => {
  const draft = content("retry-me");
  let attempts = 0;
  const getState = stateWithSave(async () => {
    attempts += 1;
    return attempts > 1;
  });
  pendingLocalSaveContents.set(PAGE_ID, draft);

  await expect(
    flushPendingLocalSaveByPageIdInternal(PAGE_ID, getState),
  ).rejects.toThrow();
  await flushPendingLocalSaveByPageIdInternal(PAGE_ID, getState);

  expect(attempts).toBe(2);
  expect(pendingLocalSaveContents.has(PAGE_ID)).toBe(false);
});

test("discard prevents an in-flight failed save from restoring stale content", async () => {
  const draft = content("discard-me");
  let finishSave: ((saved: boolean) => void) | undefined;
  const saveResult = new Promise<boolean>((resolve) => {
    finishSave = resolve;
  });
  pendingLocalSaveContents.set(PAGE_ID, draft);

  const flush = flushPendingLocalSaveByPageIdInternal(
    PAGE_ID,
    stateWithSave(async () => saveResult),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  discardPendingLocalSave(PAGE_ID);
  finishSave?.(false);
  await expect(flush).rejects.toThrow();

  expect(pendingLocalSaveContents.has(PAGE_ID)).toBe(false);
});

test("new edits after discard enter the normal save queue", async () => {
  discardPendingLocalSave(PAGE_ID);
  const next = content("new-edit");
  const getState = stateWithSave(async () => true);

  queueLocalPageSave(PAGE_ID, next, getState);
  await flushPendingLocalSaveByPageIdInternal(PAGE_ID, getState);

  expect(pendingLocalSaveContents.has(PAGE_ID)).toBe(false);
});

test("flush-all propagates a false save result to explicit callers", async () => {
  pendingLocalSaveContents.set(PAGE_ID, content("flush-all"));

  await expect(
    flushAllPendingLocalSavesInternal(stateWithSave(async () => false)),
  ).rejects.toThrow(`本地页面保存未完成：${PAGE_ID}`);
});

test("scheduled save consumes rejection while keeping content pending", async () => {
  const draft = content("scheduled");
  const unhandled: unknown[] = [];
  const loggedErrors: unknown[][] = [];
  const originalConsoleError = console.error;
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  console.error = (...args: unknown[]) => loggedErrors.push(args);

  let attempts = 0;

  try {
    queueLocalPageSave(
      PAGE_ID,
      draft,
      stateWithSave(async () => {
        attempts += 1;
        return false;
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(unhandled).toEqual([]);
    expect(loggedErrors).toHaveLength(1);
    expect(attempts).toBe(1);
    expect(pendingLocalSaveContents.get(PAGE_ID)).toBe(draft);
    expect(localSaveDebounceTimers.has(PAGE_ID)).toBe(false);
    expect(localSaveMaxWaitTimers.has(PAGE_ID)).toBe(false);
  } finally {
    console.error = originalConsoleError;
    process.off("unhandledRejection", onUnhandled);
  }
});
