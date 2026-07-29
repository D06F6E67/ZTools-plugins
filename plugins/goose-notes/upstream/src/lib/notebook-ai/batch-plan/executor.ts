import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { useTabs } from "@/stores/useTabs";
import { v4 as uuidv4 } from "uuid";
import { buildAiPageContent } from "@/lib/notebook-ai/markdown";
import { getPageTitle } from "@/components/editor/utils/page-title";
import {
  getPageContentSignature,
  guardNotebookForAiWrite,
  guardPageForAiWrite,
  writePageContentSafely,
} from "@/lib/notebook-ai/pageWriteGuard";
import { recordHistorySnapshot } from "@/lib/history/snapshot";
import { reloadEditorIfActive } from "@/lib/notebook-ai/liveWriter";
import { readBatchPlanJournal, writeBatchPlanJournal } from "./journal";
import type {
  BatchOperationResult,
  BatchPlanExecuteResult,
  BatchPlanInput,
  BatchPlanJournal,
  BatchPlanPrepareResult,
  FrozenPageSnapshot,
  PageRevision,
} from "./types";

const inFlight = new Map<string, Promise<BatchPlanExecuteResult>>();

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function revisionOf(page: {
  updatedAt: number;
  content: unknown;
}): PageRevision {
  return {
    updatedAt: page.updatedAt,
    contentSignature: getPageContentSignature(page.content),
  };
}

function sameRevision(current: PageRevision, expected: PageRevision) {
  return (
    current.updatedAt === expected.updatedAt &&
    current.contentSignature === expected.contentSignature
  );
}

function validateInput(input: BatchPlanInput): string | null {
  if (!input.title.trim() || !input.summary.trim())
    return "计划标题和摘要不能为空";
  if (input.operations.length < 1 || input.operations.length > 50)
    return "计划操作数必须在 1 到 50 之间";
  const ids = new Set<string>();
  const touched = new Set<string>();
  for (const operation of input.operations) {
    if (!operation.operationId.trim() || ids.has(operation.operationId))
      return "operationId 必须唯一且不能为空";
    ids.add(operation.operationId);
    if (
      operation.type === "create" &&
      (!operation.title.trim() || !operation.markdown.trim())
    )
      return "创建操作缺少标题或完整正文";
    if (operation.type === "edit") {
      if (!operation.pageId || !operation.markdown.trim())
        return "编辑操作缺少页面或完整正文";
      if (touched.has(operation.pageId))
        return "同一页面不能在一个计划中重复编辑或删除";
      touched.add(operation.pageId);
    }
    if (operation.type === "delete") {
      if (!operation.pageIds.length) return "删除操作至少需要一个页面";
      for (const pageId of operation.pageIds) {
        if (!pageId || touched.has(pageId))
          return "同一页面不能在一个计划中重复编辑或删除";
        touched.add(pageId);
      }
    }
  }
  return null;
}

function invalidJournal(
  toolCallId: string,
  runId: string,
  notebookId: string,
  input: BatchPlanInput,
  error: string,
): BatchPlanJournal {
  const now = Date.now();
  return {
    version: 1,
    toolCallId,
    runId,
    notebookId,
    input: clone(input),
    selectedOperationIds: [],
    status: "invalid",
    before: {},
    affectedPageIdsByOperationId: {},
    deleteBatchIdsByOperationId: {},
    plannedPageIds: {},
    after: {},
    createdPageIds: {},
    results: [],
    error,
    createdAt: now,
    updatedAt: now,
  };
}

function expandDeletePageIds(notebookId: string, rootIds: string[]): string[] {
  const pages = usePages.getState().pages;
  const expanded = new Set<string>();
  const stack = [...rootIds];
  while (stack.length) {
    const pageId = stack.pop()!;
    if (expanded.has(pageId)) continue;
    const page = pages[pageId];
    if (!page || page.workspaceId !== notebookId || page.trashedAt) continue;
    expanded.add(pageId);
    Object.values(pages).forEach((candidate) => {
      if (
        candidate.workspaceId === notebookId &&
        !candidate.trashedAt &&
        candidate.parentId === pageId
      )
        stack.push(candidate.id);
    });
  }
  return [...expanded];
}

export async function prepareBatchPlan(params: {
  toolCallId: string;
  runId: string;
  notebookId: string;
  input: BatchPlanInput;
}): Promise<BatchPlanPrepareResult> {
  const existing = readBatchPlanJournal(params.toolCallId, params.runId);
  if (existing)
    return existing.status === "invalid"
      ? { ok: false, error: existing.error || "计划无效", journal: existing }
      : { ok: true, journal: existing };
  const inputError = validateInput(params.input);
  const notebookGuard = guardNotebookForAiWrite(params.notebookId);
  if (inputError || !notebookGuard.ok) {
    const error =
      inputError ??
      (!notebookGuard.ok ? notebookGuard.error : "目标笔记本不可写入");
    const journal = writeBatchPlanJournal(
      invalidJournal(
        params.toolCallId,
        params.runId,
        params.notebookId,
        params.input,
        error,
      ),
    );
    return { ok: false, error: journal.error!, journal };
  }
  const before: Record<string, FrozenPageSnapshot> = {};
  const affectedPageIdsByOperationId: Record<string, string[]> = {};
  const deleteBatchIdsByOperationId: Record<string, string> = {};
  const plannedPageIds: Record<string, string> = {};
  const operationOwnerByPageId = new Map<string, string>();
  for (const operation of params.input.operations) {
    if (
      operation.type === "create" &&
      useNotebooks.getState().notebooks[params.notebookId]?.source ===
        "local-folder"
    ) {
      const message = "一期批量计划不支持在本地文件夹笔记本创建页面";
      const journal = writeBatchPlanJournal(
        invalidJournal(
          params.toolCallId,
          params.runId,
          params.notebookId,
          params.input,
          message,
        ),
      );
      return { ok: false, error: message, journal };
    }
    if (operation.type === "create")
      plannedPageIds[operation.operationId] = uuidv4();
    if (operation.type === "create" && operation.parentId) {
      const parent = usePages.getState().pages[operation.parentId];
      if (
        !parent ||
        parent.workspaceId !== params.notebookId ||
        Boolean(parent.trashedAt)
      ) {
        const message = "新页面的父级不存在、已在垃圾箱中或不属于当前笔记本";
        const journal = writeBatchPlanJournal(
          invalidJournal(
            params.toolCallId,
            params.runId,
            params.notebookId,
            params.input,
            message,
          ),
        );
        return { ok: false, error: message, journal };
      }
    }
    if (operation.type === "edit" && operation.title?.trim()) {
      const page = usePages.getState().pages[operation.pageId];
      if (page?.localFilePath) {
        const message = "一期批量计划不支持重命名本地文件夹页面";
        const journal = writeBatchPlanJournal(
          invalidJournal(
            params.toolCallId,
            params.runId,
            params.notebookId,
            params.input,
            message,
          ),
        );
        return { ok: false, error: message, journal };
      }
    }
    if (operation.type === "delete") {
      const requestedIds = new Set(operation.pageIds);
      for (const pageId of operation.pageIds) {
        const page = usePages.getState().pages[pageId];
        if (
          !page ||
          page.workspaceId !== params.notebookId ||
          Boolean(page.trashedAt)
        ) {
          const message = "删除目标不存在、已在垃圾箱中或不属于当前笔记本";
          const journal = writeBatchPlanJournal(
            invalidJournal(
              params.toolCallId,
              params.runId,
              params.notebookId,
              params.input,
              message,
            ),
          );
          return { ok: false, error: message, journal };
        }
        let parentId = page.parentId;
        while (parentId) {
          if (requestedIds.has(parentId)) {
            const message = "删除目标包含重复的父子页面，请只保留父页面";
            const journal = writeBatchPlanJournal(
              invalidJournal(
                params.toolCallId,
                params.runId,
                params.notebookId,
                params.input,
                message,
              ),
            );
            return { ok: false, error: message, journal };
          }
          parentId = usePages.getState().pages[parentId]?.parentId;
        }
      }
    }
    const pageIds =
      operation.type === "edit"
        ? [operation.pageId]
        : operation.type === "delete"
          ? expandDeletePageIds(params.notebookId, operation.pageIds)
          : [];
    if (operation.type === "delete")
      affectedPageIdsByOperationId[operation.operationId] = pageIds;
    if (operation.type === "delete")
      deleteBatchIdsByOperationId[operation.operationId] =
        `ai-batch-${params.runId}-${uuidv4()}`;
    for (const pageId of pageIds) {
      const owner = operationOwnerByPageId.get(pageId);
      if (owner && owner !== operation.operationId) {
        const message = "编辑或删除操作的目标页面树发生重叠";
        const journal = writeBatchPlanJournal(
          invalidJournal(
            params.toolCallId,
            params.runId,
            params.notebookId,
            params.input,
            message,
          ),
        );
        return { ok: false, error: message, journal };
      }
      operationOwnerByPageId.set(pageId, operation.operationId);
      const guard = guardPageForAiWrite(pageId, {
        expectedNotebookId: params.notebookId,
      });
      if (!guard.ok) {
        const journal = writeBatchPlanJournal(
          invalidJournal(
            params.toolCallId,
            params.runId,
            params.notebookId,
            params.input,
            guard.error,
          ),
        );
        return { ok: false, error: guard.error, journal };
      }
      if (operation.type === "delete" && guard.page.localFilePath) {
        const message = "批量计划不支持删除本地文件夹页面";
        const journal = writeBatchPlanJournal(
          invalidJournal(
            params.toolCallId,
            params.runId,
            params.notebookId,
            params.input,
            message,
          ),
        );
        return { ok: false, error: message, journal };
      }
      before[pageId] = {
        pageId,
        page: clone(guard.page),
        revision: {
          updatedAt: guard.updatedAt,
          contentSignature: guard.contentSignature,
        },
      };
    }
  }
  const now = Date.now();
  const journal: BatchPlanJournal = {
    version: 1,
    toolCallId: params.toolCallId,
    runId: params.runId,
    notebookId: params.notebookId,
    input: clone(params.input),
    selectedOperationIds: params.input.operations.map(
      (operation) => operation.operationId,
    ),
    status: "prepared",
    before,
    affectedPageIdsByOperationId,
    deleteBatchIdsByOperationId,
    plannedPageIds,
    after: {},
    createdPageIds: {},
    results: [],
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, journal: writeBatchPlanJournal(journal) };
}

function selectedOperations(journal: BatchPlanJournal) {
  const selected = new Set(journal.selectedOperationIds);
  return journal.input.operations.filter((operation) =>
    selected.has(operation.operationId),
  );
}

function successfulOperationIds(journal: BatchPlanJournal) {
  return new Set(
    journal.results
      .filter((result) => result.ok)
      .map((result) => result.operationId),
  );
}

function pendingOperations(journal: BatchPlanJournal) {
  const completed = successfulOperationIds(journal);
  return selectedOperations(journal).filter(
    (operation) => !completed.has(operation.operationId),
  );
}

function preflight(journal: BatchPlanJournal): string | null {
  const notebook = guardNotebookForAiWrite(journal.notebookId);
  if (!notebook.ok) return notebook.error;
  const pageIds = new Set<string>();
  for (const operation of pendingOperations(journal)) {
    if (operation.type === "create" && operation.parentId) {
      const parent = usePages.getState().pages[operation.parentId];
      if (
        !parent ||
        parent.workspaceId !== journal.notebookId ||
        Boolean(parent.trashedAt)
      ) {
        return "新页面的父级在审批后发生变化";
      }
    }
    if (operation.type === "edit") pageIds.add(operation.pageId);
    if (operation.type === "delete") {
      const frozenPageIds =
        journal.affectedPageIdsByOperationId[operation.operationId] ??
        operation.pageIds;
      const currentPageIds = expandDeletePageIds(
        journal.notebookId,
        operation.pageIds,
      );
      if (
        frozenPageIds.length !== currentPageIds.length ||
        frozenPageIds.some((pageId) => !currentPageIds.includes(pageId))
      ) {
        return "删除目标的页面树在审批后发生变化";
      }
      frozenPageIds.forEach((pageId) => pageIds.add(pageId));
    }
  }
  for (const pageId of pageIds) {
    const snapshot = journal.before[pageId];
    if (!snapshot) return "冻结计划缺少目标页面快照";
    const guard = guardPageForAiWrite(pageId, {
      expectedNotebookId: journal.notebookId,
      expectedRevision: snapshot.revision,
    });
    if (!guard.ok) return guard.error;
  }
  return null;
}

function resultForOperation(journal: BatchPlanJournal, operationId: string) {
  return journal.results.find(
    (result) => result.operationId === operationId && result.ok,
  );
}

function plannedContent(
  operation: Extract<
    BatchPlanInput["operations"][number],
    { type: "create" | "edit" }
  >,
  journal: BatchPlanJournal,
) {
  const title =
    operation.type === "create"
      ? operation.title
      : operation.title?.trim() ||
        getPageTitle(journal.before[operation.pageId].page) ||
        "无标题";
  return buildAiPageContent(title, operation.markdown);
}

function appendRecoveredSuccess(
  journal: BatchPlanJournal,
  result: BatchOperationResult,
  after: Record<string, PageRevision>,
  createdPageId?: string,
) {
  return writeBatchPlanJournal({
    ...journal,
    results: resultForOperation(journal, result.operationId)
      ? journal.results
      : [...journal.results, result],
    after: { ...journal.after, ...after },
    createdPageIds: createdPageId
      ? { ...journal.createdPageIds, [result.operationId]: createdPageId }
      : journal.createdPageIds,
    executingOperationId: undefined,
    executingStartedAt: undefined,
  });
}

/** 将崩溃时已写 intent、但还来不及记录 result 的操作安全归类。 */
async function recoverInterruptedOperation(
  journal: BatchPlanJournal,
): Promise<BatchPlanJournal> {
  const operationId = journal.executingOperationId;
  if (!operationId) return journal;
  const operation = journal.input.operations.find(
    (item) => item.operationId === operationId,
  );
  if (!operation) {
    return writeBatchPlanJournal({
      ...journal,
      status: "failed",
      error: "执行日志指向不存在的操作",
      executingOperationId: undefined,
      executingStartedAt: undefined,
    });
  }
  if (resultForOperation(journal, operationId)) {
    return writeBatchPlanJournal({
      ...journal,
      executingOperationId: undefined,
      executingStartedAt: undefined,
    });
  }
  if (operation.type === "create") {
    const pageId = journal.plannedPageIds[operationId];
    const page = pageId ? usePages.getState().pages[pageId] : undefined;
    if (!page)
      return writeBatchPlanJournal({
        ...journal,
        executingOperationId: undefined,
        executingStartedAt: undefined,
      });
    const expected = getPageContentSignature(
      plannedContent(operation, journal),
    );
    if (
      page.workspaceId !== journal.notebookId ||
      getPageContentSignature(page.content) !== expected
    ) {
      return writeBatchPlanJournal({
        ...journal,
        status: "failed",
        error: "中断创建页与冻结计划不一致，已停止恢复",
        executingOperationId: undefined,
        executingStartedAt: undefined,
      });
    }
    return appendRecoveredSuccess(
      journal,
      { operationId, type: "create", ok: true, pageIds: [pageId] },
      { [pageId]: revisionOf(page) },
      pageId,
    );
  }
  if (operation.type === "edit") {
    const page = usePages.getState().pages[operation.pageId];
    const before = journal.before[operation.pageId];
    if (!page || !before)
      return writeBatchPlanJournal({
        ...journal,
        status: "failed",
        error: "中断编辑的目标页不存在",
        executingOperationId: undefined,
        executingStartedAt: undefined,
      });
    if (sameRevision(revisionOf(page), before.revision))
      return writeBatchPlanJournal({
        ...journal,
        executingOperationId: undefined,
        executingStartedAt: undefined,
      });
    const expected = getPageContentSignature(
      plannedContent(operation, journal),
    );
    if (getPageContentSignature(page.content) === expected) {
      return appendRecoveredSuccess(
        journal,
        { operationId, type: "edit", ok: true, pageIds: [operation.pageId] },
        { [operation.pageId]: revisionOf(page) },
      );
    }
    return writeBatchPlanJournal({
      ...journal,
      status: "failed",
      error: "中断编辑后的内容与冻结计划不一致，已停止恢复",
      executingOperationId: undefined,
      executingStartedAt: undefined,
    });
  }
  const affected =
    journal.affectedPageIdsByOperationId[operationId] ?? operation.pageIds;
  const pages = usePages.getState().pages;
  const deleteBatchId = journal.deleteBatchIdsByOperationId[operationId];
  if (!deleteBatchId) {
    return writeBatchPlanJournal({
      ...journal,
      status: "failed",
      error: "中断删除缺少可验证的批次标记",
      executingOperationId: undefined,
      executingStartedAt: undefined,
    });
  }
  const allDeleted = affected.every((pageId) => {
    const page = pages[pageId];
    return !!page?.trashedAt && page.trashBatchId === deleteBatchId;
  });
  if (allDeleted) {
    return appendRecoveredSuccess(
      journal,
      { operationId, type: "delete", ok: true, pageIds: affected },
      Object.fromEntries(
        affected.map((pageId) => [pageId, revisionOf(pages[pageId]!)]),
      ),
    );
  }
  const allBefore = affected.every((pageId) => {
    const page = pages[pageId];
    const before = journal.before[pageId];
    return (
      !!page && !!before && sameRevision(revisionOf(page), before.revision)
    );
  });
  if (allBefore)
    return writeBatchPlanJournal({
      ...journal,
      executingOperationId: undefined,
      executingStartedAt: undefined,
    });
  for (const rootId of operation.pageIds) {
    const page = usePages.getState().pages[rootId];
    if (page?.trashedAt && page.trashBatchId === deleteBatchId) {
      usePages.getState().restorePage(rootId);
    }
  }
  return writeBatchPlanJournal({
    ...journal,
    status: "failed",
    error: "删除操作在中断时只完成了一部分，已尝试恢复已删除根页面",
    executingOperationId: undefined,
    executingStartedAt: undefined,
  });
}

async function rememberBefore(pageId: string, journal: BatchPlanJournal) {
  const snapshot = journal.before[pageId];
  if (!snapshot) return;
  await recordHistorySnapshot({
    pageId,
    workspaceId: journal.notebookId,
    content: clone(snapshot.page.content),
    trigger: "pre-op",
    isMilestone: true,
    label: `AI 批量计划 ${journal.input.title} 前`,
  });
}

async function compensate(journal: BatchPlanJournal): Promise<string[]> {
  const errors: string[] = [];
  for (const result of [...journal.results].reverse()) {
    if (!result.ok) continue;
    if (result.type === "create") {
      const pageId = journal.createdPageIds[result.operationId];
      const page = pageId ? usePages.getState().pages[pageId] : undefined;
      const after = pageId ? journal.after[pageId] : undefined;
      if (pageId && page && after && sameRevision(revisionOf(page), after)) {
        const deleted = await usePages.getState().deletePage(pageId);
        if (deleted) useTabs.getState().removeDeletedPage(pageId);
        else errors.push(`无法撤回新建页面 ${pageId}`);
      } else if (pageId) {
        errors.push(`新建页面 ${pageId} 已变化，未撤回`);
      }
      continue;
    }
    if (result.type === "delete") {
      for (const pageId of result.pageIds) {
        const page = usePages.getState().pages[pageId];
        const after = journal.after[pageId];
        if (page?.trashedAt && after && sameRevision(revisionOf(page), after)) {
          const restored = usePages.getState().restorePage(pageId);
          if (!restored.ok) errors.push(`无法恢复页面 ${pageId}`);
        } else if (page?.trashedAt) {
          errors.push(`垃圾箱页面 ${pageId} 已变化，未恢复`);
        }
      }
      continue;
    }
    for (const pageId of result.pageIds) {
      const snapshot = journal.before[pageId];
      const after = journal.after[pageId];
      if (snapshot && after) {
        const restored = await writePageContentSafely(
          pageId,
          clone(snapshot.page.content),
          {
            expectedNotebookId: journal.notebookId,
            expectedRevision: after,
          },
        );
        if (restored.ok) reloadEditorIfActive(pageId);
        else errors.push(restored.error);
      }
    }
  }
  return errors;
}

async function run(journal: BatchPlanJournal): Promise<BatchPlanExecuteResult> {
  if (journal.status === "completed")
    return { ok: true, journal, results: journal.results };
  if (journal.status === "invalid")
    return {
      ok: false,
      journal,
      error: journal.error || "计划无效",
      results: journal.results,
    };
  if (journal.selectedOperationIds.length === 0) {
    const invalid = writeBatchPlanJournal({
      ...journal,
      status: "invalid",
      error: "至少选择一项操作后才能执行",
    });
    return {
      ok: false,
      journal: invalid,
      error: invalid.error!,
      results: invalid.results,
    };
  }
  let recovered = await recoverInterruptedOperation(journal);
  if (recovered.status === "failed") {
    return {
      ok: false,
      journal: recovered,
      error: recovered.error || "中断恢复失败",
      results: recovered.results,
    };
  }
  const conflict = preflight(recovered);
  if (conflict) {
    const failed = writeBatchPlanJournal({
      ...recovered,
      status: "failed",
      error: conflict,
    });
    return {
      ok: false,
      journal: failed,
      error: conflict,
      results: failed.results,
    };
  }
  let working = writeBatchPlanJournal({
    ...recovered,
    status: "executing",
    error: undefined,
  });
  for (const operation of pendingOperations(working)) {
    // 每项真正写入前先持久化 intent；崩溃后不会把“未开始”误报成成功。
    working = writeBatchPlanJournal({
      ...working,
      executingOperationId: operation.operationId,
      executingStartedAt: Date.now(),
    });
    let result: BatchOperationResult;
    try {
      if (operation.type === "create") {
        const pageId = working.plannedPageIds[operation.operationId];
        if (!pageId) throw new Error("冻结计划缺少预分配页面 ID");
        if (usePages.getState().pages[pageId]) {
          throw new Error("预分配页面 ID 已存在，拒绝重复创建");
        }
        const content = plannedContent(operation, working);
        const created = usePages.getState().createPageRecord({
          id: pageId,
          workspaceId: working.notebookId,
          parentId: operation.parentId,
          content,
        });
        if (created !== pageId) throw new Error("创建页面返回了非预分配 ID");
        const page = usePages.getState().pages[pageId];
        if (!page) throw new Error("创建页面后未找到页面");
        working = {
          ...working,
          createdPageIds: {
            ...working.createdPageIds,
            [operation.operationId]: pageId,
          },
          after: { ...working.after, [pageId]: revisionOf(page) },
        };
        result = {
          operationId: operation.operationId,
          type: operation.type,
          ok: true,
          pageIds: [pageId],
        };
      } else if (operation.type === "edit") {
        await rememberBefore(operation.pageId, working);
        const before = working.before[operation.pageId];
        const saved = await writePageContentSafely(
          operation.pageId,
          plannedContent(operation, working),
          {
            expectedNotebookId: working.notebookId,
            expectedRevision: before.revision,
          },
        );
        if (!saved.ok) throw new Error(saved.error);
        const page = usePages.getState().pages[operation.pageId]!;
        working = {
          ...working,
          after: { ...working.after, [operation.pageId]: revisionOf(page) },
        };
        reloadEditorIfActive(operation.pageId);
        result = {
          operationId: operation.operationId,
          type: operation.type,
          ok: true,
          pageIds: [operation.pageId],
        };
      } else {
        const affectedPageIds =
          working.affectedPageIdsByOperationId[operation.operationId] ??
          operation.pageIds;
        for (const pageId of affectedPageIds)
          await rememberBefore(pageId, working);
        const deletedRootIds: string[] = [];
        const deleteBatchId =
          working.deleteBatchIdsByOperationId[operation.operationId];
        if (!deleteBatchId) throw new Error("冻结计划缺少删除批次标记");
        for (const pageId of operation.pageIds) {
          const deleted = await usePages
            .getState()
            .deletePage(pageId, { trashBatchId: deleteBatchId });
          if (!deleted) {
            const restoreErrors: string[] = [];
            for (const deletedRootId of [...deletedRootIds].reverse()) {
              const restored = usePages.getState().restorePage(deletedRootId);
              if (!restored.ok) restoreErrors.push(deletedRootId);
            }
            throw new Error(
              restoreErrors.length > 0
                ? `删除页面 ${pageId} 失败，且 ${restoreErrors.length} 个已删除页面未能恢复`
                : `删除页面 ${pageId} 失败，已恢复本项此前删除的页面`,
            );
          }
          deletedRootIds.push(pageId);
          for (const affectedPageId of affectedPageIds) {
            const page = usePages.getState().pages[affectedPageId];
            if (page)
              working = {
                ...working,
                after: { ...working.after, [affectedPageId]: revisionOf(page) },
              };
          }
        }
        affectedPageIds.forEach((pageId) =>
          useTabs.getState().removeDeletedPage(pageId),
        );
        result = {
          operationId: operation.operationId,
          type: operation.type,
          ok: true,
          pageIds: [...affectedPageIds],
        };
      }
    } catch (error) {
      result = {
        operationId: operation.operationId,
        type: operation.type,
        ok: false,
        pageIds:
          operation.type === "delete"
            ? operation.pageIds
            : operation.type === "edit"
              ? [operation.pageId]
              : [],
        error: error instanceof Error ? error.message : "执行失败",
      };
      working = writeBatchPlanJournal({
        ...working,
        results: [...working.results, result],
        status: "failed",
        error: result.error,
        executingOperationId: undefined,
        executingStartedAt: undefined,
      });
      const compensationErrors = await compensate(working);
      if (compensationErrors.length > 0) {
        working = writeBatchPlanJournal({
          ...working,
          error: `${result.error}；另有 ${compensationErrors.length} 项未能自动恢复`,
        });
      }
      return {
        ok: false,
        journal: working,
        error: working.error!,
        results: working.results,
      };
    }
    working = writeBatchPlanJournal({
      ...working,
      results: [...working.results, result],
      executingOperationId: undefined,
      executingStartedAt: undefined,
    });
  }
  working = writeBatchPlanJournal({ ...working, status: "completed" });
  return { ok: true, journal: working, results: working.results };
}

export function executePreparedBatchPlan(
  toolCallId: string,
  runId: string,
): Promise<BatchPlanExecuteResult> {
  const key = `${toolCallId}:${runId}`;
  const current = inFlight.get(key);
  if (current) return current;
  const journal = readBatchPlanJournal(toolCallId, runId);
  if (!journal) return Promise.reject(new Error("未找到批量计划"));
  const promise = run(journal).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export async function undoBatchPlan(
  toolCallId: string,
  runId: string,
): Promise<BatchPlanExecuteResult> {
  const journal = readBatchPlanJournal(toolCallId, runId);
  if (!journal) throw new Error("未找到批量计划");
  if (journal.status === "undone")
    return { ok: true, journal, results: journal.results };
  if (journal.status !== "completed")
    return {
      ok: false,
      journal,
      error: "只有已完成的批量计划可以撤回",
      results: journal.results,
    };
  for (const [pageId, after] of Object.entries(journal.after)) {
    const page = usePages.getState().pages[pageId];
    if (!page || !sameRevision(revisionOf(page), after)) {
      const conflicted = writeBatchPlanJournal({
        ...journal,
        status: "undo-conflicted",
        error: "页面在批量执行后已被修改，拒绝覆盖",
      });
      return {
        ok: false,
        journal: conflicted,
        error: conflicted.error!,
        results: conflicted.results,
      };
    }
  }
  const compensationErrors = await compensate(journal);
  if (compensationErrors.length > 0) {
    const conflicted = writeBatchPlanJournal({
      ...journal,
      status: "undo-conflicted",
      error: compensationErrors.join("；"),
    });
    return {
      ok: false,
      journal: conflicted,
      error: conflicted.error!,
      results: conflicted.results,
    };
  }
  const undone = writeBatchPlanJournal({
    ...journal,
    status: "undone",
    error: undefined,
  });
  return { ok: true, journal: undone, results: undone.results };
}
