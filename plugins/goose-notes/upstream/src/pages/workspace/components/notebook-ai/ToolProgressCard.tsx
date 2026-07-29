/**
 * User-facing progress summary for all tool parts in one assistant message.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolProgressPart {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

interface ToolProgressCardProps {
  parts: ToolProgressPart[];
  isMessageStreaming?: boolean;
}

interface ProgressStep {
  label: string;
  detail: string;
  status: "running" | "done" | "error" | "waiting";
}

const INPUT_ONLY_STATES = new Set([
  "call",
  "partial-call",
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
]);

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(text: string, max = 28) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function isInputOnly(part: ToolProgressPart) {
  return INPUT_ONLY_STATES.has(part.state ?? "");
}

function getStepStatus(
  part: ToolProgressPart,
  isMessageStreaming?: boolean,
): ProgressStep["status"] {
  if (part.state === "output-error" || part.errorText) return "error";
  if (part.state === "approval-requested") return "done";
  if (isInputOnly(part)) return isMessageStreaming ? "running" : "waiting";
  return "done";
}

function countOutput(output: unknown) {
  return Array.isArray(output) ? output.length : undefined;
}

function getStepText(
  part: ToolProgressPart,
): Pick<ProgressStep, "label" | "detail"> {
  const input = readObject(part.input);
  const output = readObject(part.output);
  const outputCount = countOutput(part.output);
  const outputError = asString(output?.error);
  const title =
    asString(input?.title) ||
    asString(output?.title) ||
    asString(input?.pageId) ||
    asString(output?.pageId);

  if (part.type === "tool-listNotebooks") {
    return {
      label: "查看记事本",
      detail:
        outputCount === undefined
          ? "正在查看可用记事本"
          : `已查看 ${outputCount} 个记事本`,
    };
  }

  if (part.type === "tool-listPages") {
    return {
      label: "查看页面列表",
      detail:
        outputCount === undefined
          ? "正在查看当前笔记本页面"
          : `已查看 ${outputCount} 个页面`,
    };
  }

  if (part.type === "tool-searchNotes") {
    const query = truncate(asString(input?.query) || "关键词");
    return {
      label: "搜索笔记",
      detail:
        outputCount === undefined
          ? `正在搜索“${query}”`
          : outputCount > 0
            ? `搜索“${query}”，找到 ${outputCount} 条`
            : `搜索“${query}”，没有匹配结果`,
    };
  }

  if (part.type === "tool-searchWeb") {
    const query = truncate(asString(input?.query) || "关键词");
    if (outputError) return { label: "联网搜索", detail: outputError };
    return {
      label: "联网搜索",
      detail: output ? `已完成“${query}”的联网搜索` : `正在搜索“${query}”`,
    };
  }

  if (part.type === "tool-readWebPage") {
    const url = asString(input?.url);
    const host = (() => {
      try {
        return url ? new URL(url).hostname : "网页";
      } catch {
        return "网页";
      }
    })();
    if (outputError) return { label: "读取网页", detail: outputError };
    return {
      label: "读取网页",
      detail: output
        ? `已读取 ${truncate(host)}`
        : `正在读取 ${truncate(host)}`,
    };
  }

  if (part.type === "tool-readPage") {
    if (outputError) return { label: "读取笔记", detail: outputError };
    return {
      label: "读取笔记",
      detail: title ? `已读取《${truncate(title)}》` : "正在读取当前笔记",
    };
  }

  if (part.type === "tool-createPage") {
    return {
      label: "创建页面",
      detail: title ? `创建《${truncate(title)}》` : "正在创建新页面",
    };
  }

  if (part.type === "tool-updatePage") {
    const ok = output?.ok === true;
    const needsMarkdown = output?.needsMarkdown === true;
    return {
      label: "写入页面",
      detail: needsMarkdown
        ? "等待完整正文后再写入"
        : ok
          ? title
            ? `已写入《${truncate(title)}》`
            : "已写入当前页"
          : title
            ? `正在写入《${truncate(title)}》`
            : "正在写入当前页",
    };
  }

  if (part.type === "tool-replaceInPage") {
    const replacedCount =
      typeof output?.replacedCount === "number"
        ? output.replacedCount
        : undefined;
    return {
      label: "替换内容",
      detail:
        replacedCount === undefined
          ? title
            ? `正在替换《${truncate(title)}》`
            : "正在替换页面内容"
          : replacedCount > 0
            ? title
              ? `《${truncate(title)}》已替换 ${replacedCount} 处`
              : `已替换 ${replacedCount} 处`
            : title
              ? `《${truncate(title)}》没有找到可替换内容`
              : "没有找到可替换内容",
    };
  }

  if (part.type === "tool-appendToPage") {
    const ok = output?.ok === true;
    return {
      label: "追加内容",
      detail: outputError
        ? outputError
        : ok
          ? title
            ? `已追加到《${truncate(title)}》`
            : "已追加到当前页"
          : title
            ? `正在追加到《${truncate(title)}》`
            : "正在追加页面内容",
    };
  }

  if (part.type === "tool-renamePage") {
    const ok = output?.ok === true;
    return {
      label: "重命名页面",
      detail: outputError
        ? outputError
        : ok
          ? title
            ? `已重命名为《${truncate(title)}》`
            : "已完成重命名"
          : title
            ? `正在重命名为《${truncate(title)}》`
            : "正在重命名页面",
    };
  }

  if (part.type === "tool-deletePages") {
    const deletedCount =
      typeof output?.deletedCount === "number"
        ? output.deletedCount
        : undefined;
    return {
      label: "删除页面",
      detail: outputError
        ? outputError
        : deletedCount === undefined
          ? "正在把页面移入垃圾箱"
          : `已删除 ${deletedCount} 个页面`,
    };
  }

  if (part.type === "tool-executeBatchPlan") {
    const operationCount = Array.isArray(input?.operations)
      ? input.operations.length
      : Array.isArray(readObject(input?.plan)?.changes)
        ? (readObject(input?.plan)?.changes as unknown[]).length
        : 0;
    if (part.state === "output-error" || part.errorText) {
      return {
        label: "生成批量计划",
        detail: "计划参数未通过校验，正在等待 AI 修正",
      };
    }
    if (
      part.state === "approval-requested" ||
      part.state === "approval-responded"
    ) {
      return {
        label: "生成批量计划",
        detail: operationCount
          ? `已生成 ${operationCount} 项操作，等待审批`
          : "计划已生成，等待审批",
      };
    }
    return {
      label: "生成批量计划",
      detail: title
        ? `正在生成《${truncate(title)}》`
        : "正在整理批量操作与审批内容",
    };
  }

  if (part.type === "tool-showTable") {
    return {
      label: "展示表格",
      detail: title ? `已生成表格《${truncate(title)}》` : "已生成表格",
    };
  }

  if (part.type === "tool-showChart") {
    return {
      label: "展示图表",
      detail: title ? `已生成图表《${truncate(title)}》` : "已生成图表",
    };
  }

  if (part.type === "tool-showDiagram") {
    return {
      label: "展示图形",
      detail: title ? `已生成图形《${truncate(title)}》` : "已生成图形",
    };
  }

  if (part.type === "tool-showSvg") {
    return {
      label: "展示 SVG",
      detail: title ? `已生成 SVG《${truncate(title)}》` : "已生成 SVG",
    };
  }

  return {
    label: "处理内容",
    detail: part.output !== undefined ? "已完成本步骤" : "正在处理请求",
  };
}

function buildSteps(
  parts: ToolProgressPart[],
  isMessageStreaming?: boolean,
): ProgressStep[] {
  return parts.map((part) => ({
    ...getStepText(part),
    status: getStepStatus(part, isMessageStreaming),
  }));
}

function buildSummary(steps: ProgressStep[]) {
  const doneSteps = steps.filter((step) => step.status === "done");
  const runningStep = steps.find((step) => step.status === "running");
  const errorStep = steps.find((step) => step.status === "error");
  const source = errorStep
    ? [errorStep]
    : runningStep
      ? [runningStep]
      : doneSteps;
  return source
    .slice(0, 3)
    .map((step) => step.detail)
    .join("、");
}

export function ToolProgressCard({
  parts,
  isMessageStreaming,
}: ToolProgressCardProps) {
  const [expanded, setExpanded] = useState(() => Boolean(isMessageStreaming));
  const steps = useMemo(
    () => buildSteps(parts, isMessageStreaming),
    [parts, isMessageStreaming],
  );

  useEffect(() => {
    setExpanded(Boolean(isMessageStreaming));
  }, [isMessageStreaming]);

  if (steps.length === 0) return null;

  const hasError = steps.some((step) => step.status === "error");
  const isRunning =
    Boolean(isMessageStreaming) ||
    steps.some((step) => step.status === "running");
  const statusText = isMessageStreaming
    ? "处理中"
    : hasError
      ? "失败"
      : isRunning
        ? "处理中"
        : "已完成";
  const summary = buildSummary(steps) || `${steps.length} 个步骤`;

  return (
    <div className="my-1 rounded-[8px] bg-[var(--goose-interactive-hover)] text-xs">
      <button
        type="button"
        className="notebook-ai-progress-toggle flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {isRunning ? (
          <Loader2
            className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
            strokeWidth={1.75}
          />
        ) : hasError ? (
          <AlertCircle
            className="h-3.5 w-3.5 shrink-0 text-destructive"
            strokeWidth={1.75}
          />
        ) : (
          <CheckCircle2
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
        )}
        <span className="shrink-0 font-medium text-foreground">处理进度</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {summary}
        </span>
        <span
          className={cn(
            "shrink-0 text-muted-foreground",
            hasError && "text-destructive",
          )}
        >
          {statusText}
        </span>
        {expanded ? (
          <ChevronDown
            className="h-3 w-3 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
        ) : (
          <ChevronRight
            className="h-3 w-3 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
        )}
      </button>

      {expanded ? (
        <div className="space-y-1 px-3 pb-2 pt-0">
          {steps.map((step, index) => (
            <div key={`${step.label}-${index}`} className="flex gap-2">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--muted-foreground))]" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">{step.label}</div>
                <div
                  className={cn(
                    "mt-0.5 break-words leading-relaxed text-muted-foreground",
                    step.status === "error" && "text-destructive",
                  )}
                >
                  {step.status === "running"
                    ? step.detail
                    : step.status === "waiting"
                      ? "本步骤未完成，可能已被本轮生成跳过。"
                      : step.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
