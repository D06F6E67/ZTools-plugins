import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { extractTextFromContent } from "@/components/editor/utils/content-text-extractor";
import { usePages } from "@/stores/usePages";
import {
  normalizeBatchPlanInput,
  readBatchPlanJournal,
} from "@/lib/notebook-ai/batch-plan";
import { cn } from "@/lib/utils";

type BatchOperation =
  | {
      operationId: string;
      type: "create";
      title: string;
      markdown: string;
      parentId?: string;
    }
  | {
      operationId: string;
      type: "edit";
      pageId: string;
      markdown: string;
      title?: string;
    }
  | {
      operationId: string;
      type: "delete";
      pageIds: string[];
    };

type BatchPlanInput = {
  runId?: string;
  title?: string;
  summary?: string;
  operations?: BatchOperation[];
};

type BatchPlanOutput = {
  ok?: boolean;
  toolCallId?: string;
  runId?: string;
  status?: string;
  appliedCount?: number;
  selectedCount?: number;
  error?: string;
  canUndo?: boolean;
};

export interface BatchApprovalResponse {
  approvalId: string;
  toolCallId: string;
  runId: string;
  approved: boolean;
  selectedOperationIds: string[];
}

export type BatchUndoResult = {
  ok: boolean;
  status?: string;
  revertedCount?: number;
  conflictCount?: number;
  error?: string;
};

interface ApprovalPlanPart {
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  toolCallId?: string;
  approval?: {
    id?: string;
    approved?: boolean;
    reason?: string;
  };
}

interface ApprovalPlanCardProps {
  part: ApprovalPlanPart;
  onApprovalResponse: (response: BatchApprovalResponse) => Promise<void> | void;
  onUndo: (toolCallId: string, runId: string) => Promise<BatchUndoResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseInput(value: unknown, toolCallId?: string): BatchPlanInput {
  const normalized = normalizeBatchPlanInput(value, {
    fallbackRunId: toolCallId ? `batch-${toolCallId}` : undefined,
    fallbackTitle: "批量变更计划",
  });
  if (!normalized) return {};
  return {
    runId: normalized.runId,
    title: normalized.title,
    summary: normalized.summary,
    operations: normalized.operations,
  };
}

function parseOutput(value: unknown): BatchPlanOutput {
  return isRecord(value) ? (value as BatchPlanOutput) : {};
}

function compactMarkdown(markdown: string, max = 120) {
  const text = markdown
    .replace(/```[\s\S]*?```/g, "代码块")
    .replace(/[#>*_`~\[\]()!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text || "空正文";
}

function operationMeta(operation: BatchOperation) {
  const pages = usePages.getState().pages;
  if (operation.type === "create") {
    return {
      icon: FilePlus2,
      label: "新建页面",
      title: operation.title || "无标题",
      detail: compactMarkdown(operation.markdown),
      danger: false,
    };
  }
  if (operation.type === "edit") {
    const page = pages[operation.pageId];
    const oldTitle = page ? getPageTitle(page) : operation.pageId;
    const beforeText = page
      ? compactMarkdown(extractTextFromContent(page.content), 160)
      : "页面当前不可用；执行前会重新校验。";
    return {
      icon: FileText,
      label: operation.title ? "修改页面与标题" : "修改页面",
      title:
        operation.title && operation.title !== oldTitle
          ? `${oldTitle} → ${operation.title}`
          : oldTitle,
      detail: `变更前\n${beforeText}\n\n变更后\n${compactMarkdown(operation.markdown, 160)}`,
      danger: false,
    };
  }
  const affectedIds = new Set<string>();
  const stack = [...operation.pageIds];
  while (stack.length > 0) {
    const pageId = stack.pop()!;
    if (affectedIds.has(pageId)) continue;
    affectedIds.add(pageId);
    Object.values(pages).forEach((page) => {
      if (!page.trashedAt && page.parentId === pageId) stack.push(page.id);
    });
  }
  const titles = operation.pageIds.map((pageId) => {
    const page = pages[pageId];
    return page ? getPageTitle(page) : pageId;
  });
  return {
    icon: Trash2,
    label: "移入垃圾箱",
    title: titles.slice(0, 3).join("、") || "未指定页面",
    detail:
      affectedIds.size > operation.pageIds.length
        ? `共 ${operation.pageIds.length} 个根页面，连同子页面将影响 ${affectedIds.size} 页。`
        : `将影响 ${affectedIds.size} 页，全部移入应用垃圾箱。`,
    danger: true,
  };
}

export function ApprovalPlanCard({
  part,
  onApprovalResponse,
  onUndo,
}: ApprovalPlanCardProps) {
  const input = parseInput(part.input, part.toolCallId);
  const output = parseOutput(part.output);
  const operations = input.operations ?? [];
  const preparedJournal = useMemo(
    () =>
      part.toolCallId && input.runId
        ? readBatchPlanJournal(part.toolCallId, input.runId)
        : null,
    [input.runId, part.state, part.toolCallId],
  );
  const invalidPlanError =
    preparedJournal?.status === "invalid" ? preparedJournal.error : undefined;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(operations.map((operation) => operation.operationId)),
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undoResult, setUndoResult] = useState<BatchUndoResult | null>(null);

  useEffect(() => {
    setSelectedIds(
      new Set(operations.map((operation) => operation.operationId)),
    );
  }, [part.toolCallId]);

  const deleteCount = useMemo(
    () =>
      operations.reduce(
        (count, operation) =>
          count + (operation.type === "delete" ? operation.pageIds.length : 0),
        0,
      ),
    [operations],
  );
  const isApprovalRequested = part.state === "approval-requested";
  const isApprovalResponded = part.state === "approval-responded";
  const isDenied =
    part.state === "output-denied" ||
    (isApprovalResponded && part.approval?.approved === false);
  const isComplete = part.state === "output-available" && output.ok === true;
  const isPersistedUndone = output.status === "undone";
  const hasError =
    Boolean(invalidPlanError) ||
    part.state === "output-error" ||
    Boolean(part.errorText) ||
    (part.state === "output-available" && output.ok === false);
  const canApprove =
    isApprovalRequested &&
    !invalidPlanError &&
    selectedIds.size > 0 &&
    !submitting;

  const respond = async (approved: boolean) => {
    const approvalId = part.approval?.id;
    const toolCallId = part.toolCallId;
    const runId = input.runId;
    if (!approvalId || !toolCallId || !runId || submitting) return;
    setSubmitting(true);
    try {
      await onApprovalResponse({
        approvalId,
        toolCallId,
        runId,
        approved,
        selectedOperationIds: approved ? [...selectedIds] : [],
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUndo = async () => {
    const toolCallId = output.toolCallId || part.toolCallId;
    if (!toolCallId || !output.runId || undoing) return;
    setUndoing(true);
    try {
      setUndoResult(await onUndo(toolCallId, output.runId));
    } finally {
      setUndoing(false);
    }
  };

  return (
    <section
      className="notebook-ai-approval-plan overflow-hidden rounded-[10px] border border-border bg-background"
      aria-label="AI 批量变更计划"
    >
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]",
              deleteCount > 0
                ? "bg-[var(--goose-color-danger-subtle-bg)] text-[var(--goose-color-danger-focus)]"
                : "bg-[var(--goose-interactive-selected)] text-foreground",
            )}
          >
            {isComplete ? (
              <Check className="h-4 w-4" strokeWidth={2} />
            ) : hasError ? (
              <AlertTriangle className="h-4 w-4" strokeWidth={1.8} />
            ) : isApprovalResponded ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            ) : (
              <FileText className="h-4 w-4" strokeWidth={1.8} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-foreground">
                {input.title?.trim() || "批量变更计划"}
              </h3>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  hasError
                    ? "bg-[var(--goose-color-danger-subtle-bg)] text-[var(--goose-color-danger-focus)]"
                    : "bg-[var(--goose-interactive-hover)] text-muted-foreground",
                )}
                aria-live="polite"
              >
                {invalidPlanError
                  ? "计划无效"
                  : isApprovalRequested
                    ? "等待审批"
                    : isDenied
                      ? "已取消"
                      : isApprovalResponded
                        ? "准备执行"
                        : isPersistedUndone || undoResult?.status === "reverted"
                          ? "已撤回"
                          : isComplete
                            ? "执行完成"
                            : hasError
                              ? "执行失败"
                              : "生成计划"}
              </span>
            </div>
            {input.summary ? (
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {input.summary}
              </p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              <span>{operations.length} 项操作</span>
              <span>{selectedIds.size} 项将执行</span>
              {deleteCount > 0 ? (
                <span className="text-[var(--goose-color-danger-focus)]">
                  含 {deleteCount} 个删除目标
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <fieldset className="divide-y divide-border">
        <legend className="sr-only">选择要批准的批量操作</legend>
        {operations.map((operation, index) => {
          const meta = operationMeta(operation);
          const Icon = meta.icon;
          const checked = selectedIds.has(operation.operationId);
          const expanded = expandedIds.has(operation.operationId);
          const detailId = `approval-plan-${part.toolCallId}-${index}`;
          return (
            <div key={operation.operationId} className="px-3 py-2.5">
              <div className="flex items-start gap-2.5">
                <label className="mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    className="notebook-ai-plan-checkbox"
                    checked={checked}
                    disabled={!isApprovalRequested}
                    onChange={(event) => {
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked)
                          next.add(operation.operationId);
                        else next.delete(operation.operationId);
                        return next;
                      });
                    }}
                    aria-label={`${checked ? "取消" : "选择"}${meta.label}《${meta.title}》`}
                  />
                </label>
                <Icon
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                    meta.danger
                      ? "text-[var(--goose-color-danger-focus)]"
                      : "text-muted-foreground",
                  )}
                  strokeWidth={1.75}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-foreground">
                        {meta.label}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {meta.title}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground hover:bg-[var(--goose-interactive-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() =>
                        setExpandedIds((current) => {
                          const next = new Set(current);
                          if (expanded) next.delete(operation.operationId);
                          else next.add(operation.operationId);
                          return next;
                        })
                      }
                      aria-expanded={expanded}
                      aria-controls={detailId}
                      aria-label={`${expanded ? "收起" : "展开"}${meta.label}预览`}
                    >
                      {expanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  {expanded ? (
                    <div
                      id={detailId}
                      className="mt-2 whitespace-pre-wrap break-words rounded-[7px] bg-[var(--goose-interactive-hover)] px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground"
                    >
                      {meta.detail}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </fieldset>

      <div className="border-t border-border px-3 py-2.5">
        {isApprovalRequested ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              className={cn(
                "text-[10px] leading-relaxed text-muted-foreground",
                invalidPlanError && "text-[var(--goose-color-danger-focus)]",
              )}
              role={invalidPlanError ? "alert" : undefined}
            >
              {invalidPlanError ||
                "批准后会先校验所有页面版本；任一页面有变化都不会开始执行。"}
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-[8px] px-3 text-xs"
                disabled={submitting}
                onClick={() => void respond(false)}
              >
                取消整批
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-[8px] px-3 text-xs"
                disabled={!canApprove}
                onClick={() => void respond(true)}
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {invalidPlanError
                  ? "计划不可执行"
                  : `批准执行 ${selectedIds.size} 项`}
              </Button>
            </div>
          </div>
        ) : isDenied ? (
          <p className="text-[11px] text-muted-foreground">
            计划已取消，页面没有变化。
          </p>
        ) : hasError ? (
          <p
            className="text-[11px] text-[var(--goose-color-danger-focus)]"
            role="alert"
          >
            {part.errorText ||
              output.error ||
              "批量执行失败，已尝试恢复此前完成的操作。"}
          </p>
        ) : isComplete ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground" aria-live="polite">
              {undoResult
                ? undoResult.ok
                  ? `已撤回 ${undoResult.revertedCount ?? 0} 项变更。`
                  : undoResult.error ||
                    `有 ${undoResult.conflictCount ?? 0} 项因页面后来被修改而未撤回。`
                : isPersistedUndone
                  ? `已撤回 ${output.appliedCount ?? selectedIds.size} 项变更。`
                  : `已执行 ${output.appliedCount ?? output.selectedCount ?? selectedIds.size} 项，撤回前会再次检查页面版本。`}
            </p>
            {output.canUndo !== false &&
            !isPersistedUndone &&
            undoResult?.ok !== true ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-auto h-8 rounded-[8px] px-3 text-xs"
                disabled={!output.runId || undoing}
                onClick={() => void handleUndo()}
              >
                {undoing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                撤回本批
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground" aria-live="polite">
            已批准，正在执行冻结后的计划…
          </p>
        )}
      </div>
    </section>
  );
}
