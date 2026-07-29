/**
 * 消息列表组件 — Streamdown 渲染 text part，自动吸底，用户上滚暂停
 */
import { Fragment, useEffect, useRef, useCallback } from "react";
import type { ComponentProps, RefObject } from "react";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import {
  Check,
  FileText,
  Image as ImageIcon,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import { ToolProgressCard } from "./ToolProgressCard";
import {
  ApprovalPlanCard,
  type BatchApprovalResponse,
  type BatchUndoResult,
} from "./ApprovalPlanCard";
import { TableCard } from "./TableCard";
import { ChartCard } from "./ChartCard";
import { DiagramCard } from "./DiagramCard";
import { SvgArtifactCard } from "./SvgArtifactCard";
import {
  shouldShowToolProgress,
  type ToolDisplayPart,
} from "./toolProgressVisibility";
import type { EditorRef } from "@/components/editor/core/Editor";
import { isNotebookAiToolPart } from "@/lib/notebook-ai/messageUtils";
import type { NotebookAiMessage } from "@/lib/notebook-ai/types";
import { cn } from "@/lib/utils";
import { useEditorPageContext } from "@/components/editor/platform/hostContext";

const ANIMATE_OPTIONS = {
  animation: "blurIn" as const,
  duration: 250,
  sep: "word" as const,
};

/** 任务列表的原生 checkbox 替换为自绘勾选框（样式见 notebook-ai.css） */
function MdInput({
  node,
  ...props
}: ComponentProps<"input"> & { node?: unknown }) {
  void node;
  if (props.type === "checkbox") {
    return (
      <span
        className="ai-md-checkbox"
        data-checked={props.checked ? "true" : "false"}
      >
        {props.checked ? <Check strokeWidth={2.5} /> : null}
      </span>
    );
  }
  return <input {...props} />;
}

const MD_COMPONENTS = { input: MdInput };

interface ChatMessagesProps {
  messages: NotebookAiMessage[];
  /** 正在流式输出的消息 id（最后一条 assistant msg id）*/
  streamingMessageId?: string;
  editorRef?: RefObject<EditorRef | null>;
  /** 全屏会话更宽、居中；侧栏保持紧凑 */
  layout?: "side-panel" | "fullscreen";
  onBatchApproval: (response: BatchApprovalResponse) => Promise<void> | void;
  onBatchUndo: (toolCallId: string, runId: string) => Promise<BatchUndoResult>;
}

const INPUT_ONLY_STATES = new Set([
  "call",
  "partial-call",
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
]);

function getTextPartText(message: NotebookAiMessage) {
  const textPart = message.parts?.find((p) => p.type === "text");
  return textPart && "text" in textPart
    ? (textPart as { text: string }).text
    : "";
}

function getUserDisplayText(message: NotebookAiMessage) {
  const metadataText = message.metadata?.displayText?.trim();
  if (metadataText) return metadataText;

  const rawText = getTextPartText(message).trim();
  const hiddenContextStart = rawText.indexOf("\n\n本轮笔记上下文：");
  if (rawText.startsWith("用户输入：") && hiddenContextStart > -1) {
    return rawText.slice("用户输入：".length, hiddenContextStart).trim();
  }
  if (rawText.startsWith("用户输入：")) {
    return rawText.slice("用户输入：".length).trim();
  }
  return rawText;
}

function getUserImageParts(message: NotebookAiMessage) {
  return (message.parts ?? []).filter(
    (
      part,
    ): part is {
      type: "file";
      url: string;
      filename?: string;
      mediaType: string;
    } =>
      part.type === "file" &&
      "url" in part &&
      typeof part.url === "string" &&
      "mediaType" in part &&
      typeof part.mediaType === "string" &&
      part.mediaType.startsWith("image/"),
  );
}

function shouldShowToolPart(
  part: ToolDisplayPart,
  isMessageStreaming: boolean,
) {
  const state = part.state ?? "";
  if (
    part.type === "tool-executeBatchPlan" &&
    (state === "approval-requested" || state === "approval-responded")
  ) {
    return true;
  }
  const hasTerminalPayload =
    state === "output-available" ||
    state === "output-error" ||
    state === "output-denied" ||
    part.output !== undefined ||
    Boolean(part.errorText);

  return (
    isMessageStreaming || !INPUT_ONLY_STATES.has(state) || hasTerminalPayload
  );
}

function renderToolVisual(
  part: ToolDisplayPart,
  key: string | number,
  editorRef: RefObject<EditorRef | null> | undefined,
) {
  if (
    part.type === "tool-showTable" &&
    part.state === "output-available" &&
    part.output
  ) {
    const tableData = part.output as {
      title?: string;
      columns: string[];
      rows: string[][];
    };
    return (
      <TableCard
        key={key}
        title={tableData.title}
        columns={tableData.columns}
        rows={tableData.rows}
      />
    );
  }

  if (
    part.type === "tool-showChart" &&
    part.state === "output-available" &&
    part.output
  ) {
    const chartData = part.output as {
      type: "bar" | "line" | "pie";
      title?: string;
      categories?: string[];
      series: Array<{ name: string; data: number[] }>;
    };
    return (
      <ChartCard
        key={key}
        type={chartData.type}
        title={chartData.title}
        categories={chartData.categories}
        series={chartData.series}
      />
    );
  }

  if (
    part.type === "tool-showDiagram" &&
    part.state === "output-available" &&
    part.output
  ) {
    const diagramData = part.output as {
      title?: string;
      language: "mermaid";
      source: string;
    };
    return (
      <DiagramCard
        key={key}
        title={diagramData.title}
        source={diagramData.source}
        editorRef={editorRef}
      />
    );
  }

  if (
    part.type === "tool-showSvg" &&
    part.state === "output-available" &&
    part.output
  ) {
    const svgData = part.output as {
      title?: string;
      svg: string;
    };
    return (
      <SvgArtifactCard
        key={key}
        title={svgData.title}
        svg={svgData.svg}
        editorRef={editorRef}
      />
    );
  }

  return null;
}

export function ChatMessages({
  messages,
  streamingMessageId,
  editorRef,
  layout = "side-panel",
  onBatchApproval,
  onBatchUndo,
}: ChatMessagesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { onOpenPage } = useEditorPageContext();
  const isUserScrolled = useRef(false);
  const lastScrollTop = useRef(0);
  const isFullscreen = layout === "fullscreen";

  const scrollToBottom = useCallback((force = false) => {
    const el = containerRef.current;
    if (!el) return;
    if (force || !isUserScrolled.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // 检测用户手动上滚
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const diff = el.scrollTop - lastScrollTop.current;
      lastScrollTop.current = el.scrollTop;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      if (atBottom) {
        isUserScrolled.current = false;
      } else if (diff < 0) {
        isUserScrolled.current = true;
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // 新消息到来时吸底
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 流式结束后强制吸底
  useEffect(() => {
    if (!streamingMessageId) {
      isUserScrolled.current = false;
      scrollToBottom(true);
    }
  }, [streamingMessageId, scrollToBottom]);

  if (messages.length === 0) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "flex flex-1 items-center justify-center overflow-y-auto",
          isFullscreen ? "px-8" : "px-5",
        )}
      >
        <div
          className={cn(
            "flex flex-col items-center gap-3 text-center",
            isFullscreen ? "max-w-[360px]" : "max-w-[260px]",
          )}
        >
          <div
            className={cn(
              "relative flex items-center justify-center rounded-[12px] bg-[var(--goose-interactive-hover)] text-muted-foreground",
              isFullscreen ? "h-12 w-12" : "h-11 w-11",
            )}
          >
            <MessageSquareText
              className={isFullscreen ? "h-6 w-6" : "h-5 w-5"}
              strokeWidth={1.75}
            />
            <Sparkles
              className="absolute -right-1 -top-1 h-3.5 w-3.5 text-muted-foreground"
              strokeWidth={1.75}
            />
          </div>
          <p
            className={cn(
              "font-medium text-foreground",
              isFullscreen ? "text-[15px]" : "text-sm",
            )}
          >
            开始和 AI 对话
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {isFullscreen
              ? "全屏会话模式：整理、搜索、创作笔记，随时可切回侧栏并排。"
              : "让它帮你整理、搜索、创作笔记。"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "notebook-ai-messages flex-1 overflow-y-auto [scrollbar-width:thin]",
        isFullscreen ? "px-6 py-5" : "px-3 py-3",
      )}
    >
      <div
        className={cn(
          "mx-auto w-full space-y-3",
          isFullscreen ? "max-w-[720px]" : "max-w-none",
        )}
      >
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const isStreaming = streamingMessageId === msg.id;

          if (isUser) {
            const text = getUserDisplayText(msg);
            const imageParts = getUserImageParts(msg);
            const persistedImages = msg.metadata?.imageAttachments ?? [];
            const references = msg.metadata?.references ?? [];
            return (
              <div key={msg.id} className="flex justify-end">
                {/* V3：用户浅色气泡 */}
                <div className="notebook-ai-message-text max-w-[85%] space-y-2 rounded-[14px] rounded-tr-[4px] bg-[#58d7b8]/12 px-3 py-2 text-sm text-foreground leading-relaxed">
                  {references.length > 0 ? (
                    <div
                      className="flex flex-wrap justify-end gap-1.5"
                      aria-label="本条消息引用的文件"
                    >
                      {references.map((reference) => (
                        <button
                          key={reference.pageId}
                          type="button"
                          onClick={() => onOpenPage(reference.pageId)}
                          className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-[7px] bg-background/45 px-2 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                          title={`打开“${reference.titleSnapshot}”`}
                          aria-label={`打开引用文件：${reference.titleSnapshot}`}
                        >
                          <FileText
                            className="h-3 w-3 shrink-0"
                            strokeWidth={1.75}
                          />
                          <span className="max-w-[180px] truncate">
                            {reference.titleSnapshot}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {imageParts.length > 0 ? (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {imageParts.map((image, index) => (
                        <img
                          key={`${image.url}-${index}`}
                          src={image.url}
                          alt={image.filename ?? "已上传图片"}
                          className="h-20 w-20 rounded-[8px] object-cover"
                        />
                      ))}
                    </div>
                  ) : persistedImages.length > 0 ? (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {persistedImages.map((image) => (
                        <span
                          key={`${image.filename}-${image.mediaType}`}
                          className="inline-flex max-w-full items-center gap-1 rounded-[6px] bg-background/45 px-1.5 py-1 text-[11px] text-muted-foreground"
                        >
                          <ImageIcon
                            className="h-3 w-3 shrink-0"
                            strokeWidth={1.75}
                          />
                          <span className="max-w-[170px] truncate">
                            {image.filename}
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {text ? <div className="select-text">{text}</div> : null}
                </div>
              </div>
            );
          }

          // assistant message — V3 软卡片
          const toolParts = (msg.parts ?? [])
            .filter(isNotebookAiToolPart)
            .filter((part) => shouldShowToolPart(part, isStreaming));
          const progressToolParts = toolParts;
          let renderedToolProgress = false;
          const showToolProgress = shouldShowToolProgress(
            progressToolParts,
            isStreaming,
          );

          return (
            <div
              key={msg.id}
              className="space-y-2 rounded-[14px] bg-[var(--goose-interactive-hover)]/70 px-3.5 py-3"
            >
              <div className="flex select-none items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[6px] bg-[#58d7b8]/15 text-[#58d7b8]">
                  <Sparkles className="h-2.5 w-2.5" strokeWidth={2.25} />
                </span>
                <span>回答</span>
              </div>
              {msg.parts?.map((part, pi) => {
                const partType = part.type;

                if (partType === "text") {
                  const textContent = (part as { text: string }).text;
                  return (
                    <div
                      key={pi}
                      className="ai-md notebook-ai-message-text select-text text-sm text-foreground"
                    >
                      <Streamdown
                        className="space-y-2"
                        components={MD_COMPONENTS}
                        isAnimating={isStreaming}
                        animated={ANIMATE_OPTIONS}
                        plugins={{ cjk }}
                        parseIncompleteMarkdown={isStreaming}
                      >
                        {textContent}
                      </Streamdown>
                    </div>
                  );
                }

                if (partType === "reasoning") {
                  return null;
                }

                // tool parts
                if (isNotebookAiToolPart(part)) {
                  const toolPart = part as ToolDisplayPart;
                  if (!shouldShowToolPart(toolPart, isStreaming)) return null;

                  if (toolPart.type === "tool-executeBatchPlan") {
                    const progress =
                      showToolProgress && !renderedToolProgress ? (
                        <ToolProgressCard
                          parts={progressToolParts}
                          isMessageStreaming={isStreaming}
                        />
                      ) : null;
                    if (progress) renderedToolProgress = true;
                    if (
                      toolPart.state === "input-streaming" ||
                      toolPart.state === "input-available" ||
                      toolPart.state === "call" ||
                      toolPart.state === "partial-call"
                    ) {
                      return <Fragment key={`batch-progress-${pi}`}>{progress}</Fragment>;
                    }
                    return (
                      <Fragment key={`approval-plan-${pi}`}>
                        {progress}
                        <ApprovalPlanCard
                          part={toolPart}
                          onApprovalResponse={onBatchApproval}
                          onUndo={onBatchUndo}
                        />
                      </Fragment>
                    );
                  }

                  const visual = renderToolVisual(
                    toolPart,
                    `visual-${pi}`,
                    editorRef,
                  );
                  if (showToolProgress && !renderedToolProgress) {
                    renderedToolProgress = true;
                    return (
                      <Fragment key={pi}>
                        <ToolProgressCard
                          parts={progressToolParts}
                          isMessageStreaming={isStreaming}
                        />
                        {visual}
                      </Fragment>
                    );
                  }

                  return visual;
                }

                return null;
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
