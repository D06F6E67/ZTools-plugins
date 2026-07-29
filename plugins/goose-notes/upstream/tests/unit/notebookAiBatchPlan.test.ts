import { expect, test } from "playwright/test";
import type { JSONContent, Page } from "../../src/types";
import {
  executePreparedBatchPlan,
  prepareBatchPlan,
  undoBatchPlan,
} from "../../src/lib/notebook-ai/batch-plan/executor";
import { normalizeBatchPlanInput } from "../../src/lib/notebook-ai/batch-plan/input";
import { updateBatchPlanSelection } from "../../src/lib/notebook-ai/batch-plan/journal";
import { writeBatchPlanJournal } from "../../src/lib/notebook-ai/batch-plan/journal";
import type { BatchPlanInput } from "../../src/lib/notebook-ai/batch-plan/types";
import { buildAiPageContent } from "../../src/lib/notebook-ai/markdown";
import { getPageTitle } from "../../src/components/editor/utils/page-title";
import {
  prepareNotebookAiMessagesForModel,
  sanitizeNotebookAiMessages,
} from "../../src/lib/notebook-ai/messageUtils";
import type { NotebookAiMessage } from "../../src/lib/notebook-ai/types";
import { useNotebooks } from "../../src/stores/useNotebooks";
import { usePages } from "../../src/stores/usePages";

let sequence = 0;
let writeCalls = 0;
let originalWritePageContent = usePages.getState().writePageContent;

function content(text: string): JSONContent {
  return [{ type: "paragraph", content: text }];
}

function makePage(
  id: string,
  text: string,
  overrides: Partial<Page> = {},
): Page {
  return {
    id,
    workspaceId: "batch-notebook",
    content: content(text),
    isLocked: false,
    isFullWidth: false,
    fontSize: "default",
    fontFamily: "default",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function ids(label: string) {
  sequence += 1;
  return {
    toolCallId: `batch-tool-${label}-${sequence}`,
    runId: `batch-run-${label}-${sequence}`,
  };
}

function plan(operations: BatchPlanInput["operations"]): BatchPlanInput {
  return {
    title: "批量更新",
    summary: "测试批量计划的冻结、执行与撤回",
    operations,
  };
}

function textOf(pageId: string) {
  return JSON.stringify(usePages.getState().pages[pageId]?.content);
}

function installStorage() {
  const values = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    // 页面 store 的持久化/编辑器同步会广播事件；单测只需存储行为。
    dispatchEvent: () => true,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  };
}

function installWriteMock() {
  usePages.setState({
    writePageContent: async (pageId, nextContent) => {
      writeCalls += 1;
      usePages.setState((state) => {
        const page = state.pages[pageId];
        if (!page) return state;
        return {
          pages: {
            ...state.pages,
            [pageId]: {
              ...page,
              content: nextContent,
              // 固定递增，避免同一毫秒的 updatedAt 造成测试偶现。
              updatedAt: page.updatedAt + 1,
            },
          },
        };
      });
      return true;
    },
  });
}

function installState(
  pages: Record<string, Page>,
  source: "default" | "local-folder" = "default",
) {
  useNotebooks.setState({
    notebooks: {
      "batch-notebook": {
        id: "batch-notebook",
        name: "批量测试",
        createdAt: 1,
        updatedAt: 1,
        source,
        ...(source === "local-folder" ? { localPath: "/tmp/goose-batch" } : {}),
      },
    },
    activeNotebookId: "batch-notebook",
  });
  usePages.setState({ pages, activePageId: null });
  installWriteMock();
}

test.beforeEach(() => {
  originalWritePageContent = usePages.getState().writePageContent;
  writeCalls = 0;
  installStorage();
});

test("批量计划会补齐操作 ID，并兼容单个删除 pageId", () => {
  const normalized = normalizeBatchPlanInput({
    runId: "normalize-run",
    title: "汇总文档",
    summary: "新建汇总页并删除旧页面",
    operations: [
      {
        type: "create",
        title: "汇总页",
        markdown: "汇总正文",
      },
      {
        type: "delete",
        pageId: "page-to-delete",
      },
    ],
  });

  expect(normalized?.operations).toEqual([
    {
      type: "create",
      operationId: "create-1",
      title: "汇总页",
      markdown: "汇总正文",
    },
    {
      type: "delete",
      operationId: "delete-2",
      pageIds: ["page-to-delete"],
    },
  ]);
});

test("批量计划兼容 create_page/delete_page 别名", () => {
  const normalized = normalizeBatchPlanInput(
    {
      operations: [
        { type: "create_page", title: "汇总页", markdown: "汇总正文" },
        { type: "delete_page", pageId: "old-page" },
      ],
    },
    {
      fallbackRunId: "alias-run",
      fallbackTitle: "别名计划",
    },
  );

  expect(normalized?.runId).toBe("alias-run");
  expect(normalized?.summary).toBe("别名计划");
  expect(normalized?.operations).toEqual([
    {
      type: "create",
      operationId: "create-1",
      title: "汇总页",
      markdown: "汇总正文",
    },
    {
      type: "delete",
      operationId: "delete-2",
      pageIds: ["old-page"],
    },
  ]);
});

test("批量计划兼容 plan.changes 与 action 形式", () => {
  const normalized = normalizeBatchPlanInput(
    {
      plan: {
        summary: "兼容包装后的变更计划",
        changes: [
          { action: "create", title: "汇总页", markdown: "汇总正文" },
          { action: "delete", pageId: "old-page" },
        ],
      },
    },
    {
      fallbackRunId: "batch-tool-call",
      fallbackTitle: "批量变更计划",
    },
  );

  expect(normalized).toMatchObject({
    runId: "batch-tool-call",
    title: "批量变更计划",
    summary: "兼容包装后的变更计划",
    operations: [
      { type: "create", operationId: "create-1" },
      { type: "delete", operationId: "delete-2", pageIds: ["old-page"] },
    ],
  });
});

test("待审批计划会保留在持久化消息中，重开会话后仍可继续", () => {
  const messages = [
    {
      id: "approval-message",
      role: "assistant",
      parts: [
        {
          type: "tool-executeBatchPlan",
          toolCallId: "approval-tool",
          state: "approval-requested",
          input: {
            runId: "approval-run",
            title: "待审批计划",
            summary: "跨页修改",
            operations: [],
          },
          approval: { id: "approval-id" },
        },
      ],
    },
  ] as unknown as NotebookAiMessage[];

  const sanitized = sanitizeNotebookAiMessages(messages);
  expect(sanitized).toHaveLength(1);
  expect(sanitized[0].parts).toHaveLength(1);
  expect((sanitized[0].parts[0] as { state?: string }).state).toBe(
    "approval-requested",
  );
});

test("批量计划保留在本地会话，但不会再次发送给兼容模型", () => {
  const messages = [
    {
      id: "completed-batch-message",
      role: "assistant",
      parts: [
        { type: "text", text: "批量计划已执行。" },
        {
          type: "tool-executeBatchPlan",
          toolCallId: "completed-batch-tool",
          state: "output-available",
          input: { runId: "completed-batch-run", operations: [] },
          output: { ok: true, status: "undone", canUndo: false },
        },
      ],
    },
  ] as unknown as NotebookAiMessage[];

  expect(sanitizeNotebookAiMessages(messages)[0].parts).toHaveLength(2);

  const prepared = prepareNotebookAiMessagesForModel(messages);
  expect(prepared).toHaveLength(1);
  expect(prepared[0].parts).toEqual([
    { type: "text", text: "批量计划已执行。" },
  ]);
});

test.afterEach(() => {
  usePages.setState({
    pages: {},
    activePageId: null,
    writePageContent: originalWritePageContent,
  });
  useNotebooks.setState({ notebooks: {}, activeNotebookId: null });
  delete (globalThis as { window?: unknown }).window;
});

test("冻结计划在审批/执行前零写入，并保存每个目标页的 revision", async () => {
  const pageA = makePage("batch-freeze-a", "旧内容 A", { updatedAt: 11 });
  const pageB = makePage("batch-freeze-b", "旧内容 B", { updatedAt: 22 });
  installState({ [pageA.id]: pageA, [pageB.id]: pageB });
  const { toolCallId, runId } = ids("freeze");

  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "edit",
        operationId: "edit-a",
        pageId: pageA.id,
        markdown: "新内容 A",
      },
      {
        type: "edit",
        operationId: "edit-b",
        pageId: pageB.id,
        markdown: "新内容 B",
      },
    ]),
  });

  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;
  expect(writeCalls).toBe(0);
  expect(prepared.journal.status).toBe("prepared");
  expect(prepared.journal.before[pageA.id].revision).toEqual({
    updatedAt: 11,
    contentSignature: JSON.stringify(pageA.content),
  });
  expect(prepared.journal.before[pageB.id].revision).toEqual({
    updatedAt: 22,
    contentSignature: JSON.stringify(pageB.content),
  });
  expect(textOf(pageA.id)).toContain("旧内容 A");
  expect(textOf(pageB.id)).toContain("旧内容 B");
});

test("冻结后任一版本变化会在 preflight 整批拒绝，零页面写入", async () => {
  const pageA = makePage("batch-conflict-a", "旧内容 A");
  const pageB = makePage("batch-conflict-b", "旧内容 B");
  installState({ [pageA.id]: pageA, [pageB.id]: pageB });
  const { toolCallId, runId } = ids("preflight-conflict");
  await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "edit",
        operationId: "edit-a",
        pageId: pageA.id,
        markdown: "新内容 A",
      },
      {
        type: "edit",
        operationId: "edit-b",
        pageId: pageB.id,
        markdown: "新内容 B",
      },
    ]),
  });

  usePages.setState((state) => ({
    pages: {
      ...state.pages,
      [pageB.id]: {
        ...state.pages[pageB.id],
        content: content("用户并发编辑"),
        updatedAt: 2,
      },
    },
  }));
  const result = await executePreparedBatchPlan(toolCallId, runId);

  expect(result.ok).toBe(false);
  expect(result.journal.status).toBe("failed");
  expect(writeCalls).toBe(0);
  expect(textOf(pageA.id)).toContain("旧内容 A");
  expect(textOf(pageB.id)).toContain("用户并发编辑");
});

test("可在审批前选择子集，未选择操作不执行", async () => {
  const pageA = makePage("batch-select-a", "旧内容 A");
  const pageB = makePage("batch-select-b", "旧内容 B");
  installState({ [pageA.id]: pageA, [pageB.id]: pageB });
  const { toolCallId, runId } = ids("selection");
  await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "edit",
        operationId: "edit-a",
        pageId: pageA.id,
        markdown: "仅更新 A",
      },
      {
        type: "edit",
        operationId: "edit-b",
        pageId: pageB.id,
        markdown: "不应更新 B",
      },
    ]),
  });

  const selected = updateBatchPlanSelection(toolCallId, runId, [
    "edit-a",
    "不存在",
    "edit-a",
  ]);
  expect(selected?.selectedOperationIds).toEqual(["edit-a"]);
  const result = await executePreparedBatchPlan(toolCallId, runId);

  expect(result.ok, result.ok ? undefined : result.error).toBe(true);
  expect(result.results).toEqual([
    { operationId: "edit-a", type: "edit", ok: true, pageIds: [pageA.id] },
  ]);
  expect(textOf(pageA.id)).toContain("仅更新 A");
  expect(textOf(pageB.id)).toContain("旧内容 B");
  expect(writeCalls).toBe(1);
});

test("成功执行后可整批撤回，重复执行保持幂等", async () => {
  const pageA = makePage("batch-undo-a", "撤回前 A");
  const pageB = makePage("batch-undo-b", "撤回前 B");
  installState({ [pageA.id]: pageA, [pageB.id]: pageB });
  const { toolCallId, runId } = ids("undo");
  await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "edit",
        operationId: "edit-a",
        pageId: pageA.id,
        markdown: "执行后 A",
      },
      {
        type: "edit",
        operationId: "edit-b",
        pageId: pageB.id,
        markdown: "执行后 B",
      },
    ]),
  });

  const first = await executePreparedBatchPlan(toolCallId, runId);
  const repeated = await executePreparedBatchPlan(toolCallId, runId);

  expect(first.ok, first.ok ? undefined : first.error).toBe(true);
  expect(repeated.ok).toBe(true);
  expect(writeCalls).toBe(2);
  expect(textOf(pageA.id)).toContain("执行后 A");
  expect(textOf(pageB.id)).toContain("执行后 B");

  const undone = await undoBatchPlan(toolCallId, runId);
  expect(undone.ok).toBe(true);
  expect(undone.journal.status).toBe("undone");
  expect(textOf(pageA.id)).toContain("撤回前 A");
  expect(textOf(pageB.id)).toContain("撤回前 B");
  expect(writeCalls).toBe(4);
});

test("执行后用户编辑会让整批撤回冲突，且不会覆盖用户内容", async () => {
  const page = makePage("batch-undo-conflict", "原始内容");
  installState({ [page.id]: page });
  const { toolCallId, runId } = ids("undo-conflict");
  await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "edit",
        operationId: "edit",
        pageId: page.id,
        markdown: "AI 批量内容",
      },
    ]),
  });
  await executePreparedBatchPlan(toolCallId, runId);

  usePages.setState((state) => ({
    pages: {
      ...state.pages,
      [page.id]: {
        ...state.pages[page.id],
        content: content("用户后续编辑"),
        updatedAt: 99,
      },
    },
  }));
  const undone = await undoBatchPlan(toolCallId, runId);

  expect(undone.ok).toBe(false);
  expect(undone.journal.status).toBe("undo-conflicted");
  expect(textOf(page.id)).toContain("用户后续编辑");
  expect(writeCalls).toBe(1);
});

test("本地文件夹删除计划在冻结阶段即标记为 invalid，且零写入", async () => {
  const localPage = makePage("batch-local-delete", "本地内容", {
    localFilePath: "/tmp/goose-batch/a.md",
  });
  installState({ [localPage.id]: localPage }, "local-folder");
  const { toolCallId, runId } = ids("local-delete");

  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      { type: "delete", operationId: "delete-local", pageIds: [localPage.id] },
    ]),
  });

  expect(prepared.ok).toBe(false);
  expect(prepared.journal?.status).toBe("invalid");
  expect(prepared.error).toContain("不支持删除本地文件夹页面");
  expect(writeCalls).toBe(0);
  expect(usePages.getState().pages[localPage.id]).toBeDefined();
});

test("审批后删除树新增子页面时整批拒绝，不删除未预览页面", async () => {
  const parent = makePage("batch-delete-tree-parent", "父页面");
  const child = makePage("batch-delete-tree-child", "原子页面", {
    parentId: parent.id,
  });
  installState({ [parent.id]: parent, [child.id]: child });
  const { toolCallId, runId } = ids("delete-tree-change");
  await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "delete",
        operationId: "delete-tree",
        pageIds: [parent.id],
      },
    ]),
  });

  const lateChild = makePage("batch-delete-tree-late-child", "审批后新建", {
    parentId: parent.id,
  });
  usePages.setState((state) => ({
    pages: { ...state.pages, [lateChild.id]: lateChild },
  }));
  const result = await executePreparedBatchPlan(toolCallId, runId);

  expect(result.ok).toBe(false);
  expect(result.ok ? "" : result.error).toContain("页面树在审批后发生变化");
  expect(usePages.getState().pages[parent.id].trashedAt).toBeUndefined();
  expect(usePages.getState().pages[child.id].trashedAt).toBeUndefined();
  expect(usePages.getState().pages[lateChild.id].trashedAt).toBeUndefined();
});

test("同一删除操作中途失败时恢复本项已删除页面", async () => {
  const pageA = makePage("batch-delete-partial-a", "页面 A");
  const pageB = makePage("batch-delete-partial-b", "页面 B");
  installState({ [pageA.id]: pageA, [pageB.id]: pageB });
  const { toolCallId, runId } = ids("delete-partial");
  await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "delete",
        operationId: "delete-two-roots",
        pageIds: [pageA.id, pageB.id],
      },
    ]),
  });

  const originalDeletePage = usePages.getState().deletePage;
  usePages.setState({
    deletePage: async (pageId) =>
      pageId === pageB.id ? false : originalDeletePage(pageId),
  });
  try {
    const result = await executePreparedBatchPlan(toolCallId, runId);
    expect(result.ok).toBe(false);
    expect(usePages.getState().pages[pageA.id].trashedAt).toBeUndefined();
    expect(usePages.getState().pages[pageB.id].trashedAt).toBeUndefined();
  } finally {
    usePages.setState({ deletePage: originalDeletePage });
  }
});

test("创建页已落地但结果日志中断时按预分配 ID 恢复，不重复创建", async () => {
  installState({});
  const { toolCallId, runId } = ids("recover-create");
  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "create",
        operationId: "create-page",
        title: "中断创建",
        markdown: "确定性正文",
      },
    ]),
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;

  const pageId = prepared.journal.plannedPageIds["create-page"];
  usePages.getState().createPageRecord({
    id: pageId,
    workspaceId: "batch-notebook",
    content: buildAiPageContent("中断创建", "确定性正文"),
  });
  writeBatchPlanJournal({
    ...prepared.journal,
    status: "executing",
    executingOperationId: "create-page",
    executingStartedAt: Date.now() - 1,
  });

  const result = await executePreparedBatchPlan(toolCallId, runId);
  expect(result.ok, result.ok ? undefined : result.error).toBe(true);
  expect(result.journal.status).toBe("completed");
  expect(
    result.results.filter((item) => item.operationId === "create-page"),
  ).toHaveLength(1);
  expect(Object.keys(usePages.getState().pages)).toEqual([pageId]);
});

test("编辑已落地但结果日志中断时按计划后签名补记，不重复写入", async () => {
  const page = makePage("batch-recover-edit", "冻结前正文");
  installState({ [page.id]: page });
  const { toolCallId, runId } = ids("recover-edit");
  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "edit",
        operationId: "edit-page",
        pageId: page.id,
        markdown: "已经落地的计划正文",
      },
    ]),
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;

  usePages.setState((state) => ({
    pages: {
      ...state.pages,
      [page.id]: {
        ...state.pages[page.id],
        content: buildAiPageContent(
          getPageTitle(prepared.journal.before[page.id].page),
          "已经落地的计划正文",
        ),
        updatedAt: state.pages[page.id].updatedAt + 1,
      },
    },
  }));
  writeBatchPlanJournal({
    ...prepared.journal,
    status: "executing",
    executingOperationId: "edit-page",
    executingStartedAt: Date.now() - 1,
  });

  const result = await executePreparedBatchPlan(toolCallId, runId);
  expect(result.ok, result.ok ? undefined : result.error).toBe(true);
  expect(result.journal.status).toBe("completed");
  expect(writeCalls).toBe(0);
  expect(textOf(page.id)).toContain("已经落地的计划正文");
});

test("删除恢复只认 Agent 批次标记，不接管用户自行删除的页面", async () => {
  const page = makePage("batch-recover-user-delete", "用户页面");
  installState({ [page.id]: page });
  const { toolCallId, runId } = ids("recover-user-delete");
  const prepared = await prepareBatchPlan({
    toolCallId,
    runId,
    notebookId: "batch-notebook",
    input: plan([
      {
        type: "delete",
        operationId: "delete-page",
        pageIds: [page.id],
      },
    ]),
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;

  // 模拟 intent 落盘后，用户通过普通入口自行删除；它会得到不同的 trashBatchId。
  expect(await usePages.getState().deletePage(page.id)).toBe(true);
  writeBatchPlanJournal({
    ...prepared.journal,
    status: "executing",
    executingOperationId: "delete-page",
    executingStartedAt: Date.now() - 1,
  });

  const result = await executePreparedBatchPlan(toolCallId, runId);
  expect(result.ok).toBe(false);
  expect(result.journal.status).toBe("failed");
  expect(usePages.getState().pages[page.id].trashedAt).toBeDefined();
  expect(usePages.getState().pages[page.id].trashBatchId).not.toBe(
    prepared.journal.deleteBatchIdsByOperationId["delete-page"],
  );
});
