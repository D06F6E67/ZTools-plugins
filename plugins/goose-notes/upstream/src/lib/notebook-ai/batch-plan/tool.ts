import { tool } from "ai";
import { z } from "zod";
import type { NotebookAiAgentContext } from "../types";
import { executePreparedBatchPlan, prepareBatchPlan } from "./executor";
import { normalizeBatchPlanInput } from "./input";

const optionalOperationId = z
  .string()
  .min(1)
  .optional()
  .describe("可选的操作唯一标识；省略时由应用自动生成");

const typedOperationSchema = z.union([
  z.object({
    type: z.enum(["create", "create_page", "createPage"]),
    operationId: optionalOperationId,
    title: z.string().min(1),
    markdown: z.string().min(1),
    parentId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.enum(["edit", "edit_page", "editPage"]),
    operationId: optionalOperationId,
    pageId: z.string().min(1),
    markdown: z.string().min(1),
    title: z.string().min(1).optional(),
  }),
  z.object({
    type: z.enum(["delete", "delete_page", "deletePage"]),
    operationId: optionalOperationId,
    pageIds: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe("要删除的一个或多个页面 ID"),
    pageId: z
      .string()
      .min(1)
      .optional()
      .describe("仅删除一个页面时可用，应用会转换成 pageIds"),
  }),
]);

const actionOperationSchema = z.union([
  z.object({
    action: z.literal("create"),
    operationId: optionalOperationId,
    title: z.string().min(1),
    markdown: z.string().min(1),
    parentId: z.string().min(1).optional(),
  }),
  z.object({
    action: z.literal("edit"),
    operationId: optionalOperationId,
    pageId: z.string().min(1),
    markdown: z.string().min(1),
    title: z.string().min(1).optional(),
  }),
  z.object({
    action: z.literal("delete"),
    operationId: optionalOperationId,
    pageIds: z.array(z.string().min(1)).min(1).optional(),
    pageId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
  }),
]);

const operationSchema = z.union([
  typedOperationSchema,
  actionOperationSchema,
]);

const inputSchema = z.union([
  z.object({
    runId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    operations: z.array(operationSchema).min(1).max(50),
  }),
  z.object({
    plan: z.object({
      runId: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      summary: z.string().min(1).optional(),
      changes: z.array(operationSchema).min(1).max(50),
    }),
  }),
]);

/**
 * 仅供跨页或至少两项写操作使用。输入必须是模型已经完整生成的冻结结果；
 * needsApproval 会持久化零写入计划，批准后 execute 才真正改动页面。
 */
export const executeBatchPlan = tool({
  description:
    "执行一个需要用户批准的跨页批量写入计划。仅用于至少 2 项写操作或跨页批量操作；必须提供完整、冻结的 create/edit/delete 结果，不能用于单页即时编辑。推荐使用顶层 runId/title/summary/operations；operationId 可省略；删除单页可传 pageId，删除多页传 pageIds。兼容 create_page/delete_page 和 plan.changes 形式。",
  inputSchema,
  needsApproval: async (input, { experimental_context, toolCallId }) => {
    const context = experimental_context as NotebookAiAgentContext;
    const normalized = normalizeBatchPlanInput(input, {
      fallbackRunId: `batch-${toolCallId}`,
      fallbackTitle: "批量变更计划",
    });
    if (!normalized) return true;
    const { runId, ...planInput } = normalized;
    const prepared = await prepareBatchPlan({
      toolCallId,
      runId,
      notebookId: context.notebookId,
      input: planInput,
    });
    // 即使冻结校验失败也请求一次批准：这样 execute 能返回明确的 invalid 状态，
    // 而不是让 SDK 把它当成普通工具调用直接执行。
    void prepared;
    return true;
  },
  execute: async (input, { toolCallId }) => {
    const fallbackRunId = `batch-${toolCallId}`;
    const normalized = normalizeBatchPlanInput(input, {
      fallbackRunId,
      fallbackTitle: "批量变更计划",
    });
    if (!normalized) {
      return {
        ok: false,
        toolCallId,
        runId: fallbackRunId,
        status: "invalid",
        error: "批量计划参数不完整",
        appliedCount: 0,
        selectedCount: 0,
        canUndo: false,
        results: [],
      };
    }
    let result;
    try {
      result = await executePreparedBatchPlan(toolCallId, normalized.runId);
    } catch (error) {
      return {
        ok: false,
        toolCallId,
        runId: normalized.runId,
        status: "invalid",
        error: error instanceof Error ? error.message : "批量计划执行失败",
        appliedCount: 0,
        selectedCount: 0,
        canUndo: false,
        results: [],
      };
    }
    const appliedCount = result.results.filter((item) => item.ok).length;
    const selectedCount = result.journal.selectedOperationIds.length;
    const canUndo = result.ok && result.journal.status === "completed";
    return result.ok
      ? {
          ok: true,
          toolCallId,
          runId: normalized.runId,
          status: result.journal.status,
          appliedCount,
          selectedCount,
          canUndo,
          results: result.results,
        }
      : {
          ok: false,
          toolCallId,
          runId: normalized.runId,
          status: result.journal.status,
          error: result.error,
          appliedCount,
          selectedCount,
          canUndo,
          results: result.results,
        };
  },
});
