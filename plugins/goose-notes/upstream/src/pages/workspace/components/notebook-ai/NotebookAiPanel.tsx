/**
 * NotebookAiPanel — AI 聊天面板（右侧并排，可拖宽）
 *
 * - useChat（@ai-sdk/react）+ DirectChatTransport proxy
 * - 会话按 notebookId 隔离持久化（useNotebookAiChats）
 * - 每轮发送绑定当前活动页签 pageId，避免新建/切换页面影响当前请求
 * - 流式写入页面：handleStreamingWritePart + cleanupWriterSession
 */
import {
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { useChat } from "@ai-sdk/react";
import type { ChatTransport } from "ai";
import {
  X,
  Plus,
  CircleAlert,
  MoreHorizontal,
  PanelRight,
  AppWindow,
  History as HistoryIcon,
  Check,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import type { RefObject } from "react";
import type { EditorRef } from "@/components/editor/core/Editor";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { useNotebookAiChats } from "@/stores/useNotebookAiChats";
import { useAiStatus } from "@/stores/useAiStatus";
import { buildTransport } from "@/lib/notebook-ai/transport";
import {
  handleStreamingWritePart,
  cleanupWriterSession,
  reloadEditorIfActive,
  type StreamingWritePart,
} from "@/lib/notebook-ai/liveWriter";
import {
  executePreparedBatchPlan,
  undoBatchPlan,
  updateBatchPlanSelection,
} from "@/lib/notebook-ai/batch-plan";
import { buildLanguageModel } from "@/lib/notebook-ai/model";
import {
  buildNotebookAiUserMessage,
  getCurrentNotebookAiPageId,
  getNotebookAiReferenceSuggestions,
} from "@/lib/notebook-ai/context";
import {
  prepareNotebookAiMessagesForModel,
  sanitizeNotebookAiMessages,
} from "@/lib/notebook-ai/messageUtils";
import {
  applyBlockTypeTransformToEditor,
  createPageBodyBlockTypeTransformSnapshot,
  hasWholePageBlockTypeTransformScope,
  isBlockTypeTransformSelectionSnapshot,
  planBlockTypeTransform,
  resolveBlockTypeTransformIntent,
  type BlockTypeTransformBlock,
  type BlockTypeTransformSelectionSnapshot,
} from "@/lib/ai-write";
import { ChatMessages } from "./ChatMessages";
import type {
  BatchApprovalResponse,
  BatchUndoResult,
} from "./ApprovalPlanCard";
import { Composer } from "./Composer";
import type { NotebookAiImageAttachment } from "./Composer";
import { usePanelWidth } from "./usePanelWidth";
import { ConversationHistoryList } from "./ConversationHistoryPopover";
import type {
  NotebookAiLayoutMode,
  NotebookAiPanelSelectionCapture,
} from "./useNotebookAiPanel";
import { isFullscreenAiLayout } from "./useNotebookAiPanel";
import { clearAiHeaderActions, setAiHeaderActions } from "./aiHeaderSlot";
import type { AiComposerPayload } from "@/components/editor/ai/composer/referenceLookup";
import { buildAiFileReferenceAttrs } from "@/components/editor/ai/composer/referenceLookup";
import type { NotebookAiMessage } from "@/lib/notebook-ai/types";
import type { JSONContent, Page } from "@/types";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NotebookAiPanelProps {
  notebookId: string;
  onClose: () => void;
  editorRef?: RefObject<EditorRef | null>;
  capturedSelection?: NotebookAiPanelSelectionCapture | null;
  onConsumeCapturedSelection?: () => void;
  /** 打开方式：侧栏并排 / 全屏 */
  layoutMode?: NotebookAiLayoutMode;
  onLayoutModeChange?: (mode: NotebookAiLayoutMode) => void;
  /** 侧栏可拖宽；全屏铺满主区域 */
  variant?: "side-panel" | "fullscreen";
}

const NOTEBOOK_AI_PLACEHOLDER_HINTS = [
  "向 AI 提问，输入 @ 引用当前笔记本页面…",
  "让 AI 根据当前笔记生成一张趋势图…",
  "让 AI 画一个流程图或架构图…",
  "让 AI 生成 SVG 图标或矢量示意图…",
  "试试：总结 @页面，并画出要点关系图…",
];

function formatChatError(error: Error): string {
  const message = error.message?.trim() || "";
  if (!message) return "本轮请求失败，请稍后重试。";

  const lower = message.toLowerCase();
  if (
    lower.includes("api key required") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("authentication")
  ) {
    return `${message}。请到「设置 → AI 助手」检查 API Key 与 Base URL。`;
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("network request failed")
  ) {
    return "无法连接 AI 服务。请检查 Base URL、网络或代理是否可达。";
  }
  if (
    lower.includes("responses") &&
    (lower.includes("404") ||
      lower.includes("not found") ||
      lower.includes("not supported"))
  ) {
    return `${message}。当前协议为 OpenAI Responses，若你的服务只支持 Chat Completions，请确认服务端兼容 /v1/responses。`;
  }

  return message;
}

function createChatMessageId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createImageFileList(
  images: NotebookAiImageAttachment[],
): FileList | undefined {
  if (images.length === 0) return undefined;
  const dataTransfer = new DataTransfer();
  images.forEach(({ file }) => dataTransfer.items.add(file));
  return dataTransfer.files;
}

function getPageBlocks(content: unknown): BlockTypeTransformBlock[] {
  if (Array.isArray(content)) {
    return content as BlockTypeTransformBlock[];
  }
  if (
    content &&
    typeof content === "object" &&
    Array.isArray((content as { content?: unknown }).content)
  ) {
    return (content as { content: BlockTypeTransformBlock[] }).content;
  }
  return [];
}

function getTransformTargetError(
  page: Page | undefined,
  notebookId: string,
): string | null {
  if (!page) return "当前页面不存在，未转换待办事项。";
  if (page.workspaceId !== notebookId) {
    return "当前页面不属于这个记事本，未转换待办事项。";
  }
  if (page.isFolder) return "文件夹不能转换为待办事项。";
  if (page.trashedAt) return "回收站页面不能被修改。";
  if (page.isLocked) return "页面已锁定，未转换待办事项。";
  if (page.localFilePath && page.localReadState === "error") {
    return "本地页面读取失败，未转换待办事项。";
  }
  return null;
}

export function NotebookAiPanel({
  notebookId,
  onClose,
  editorRef,
  capturedSelection,
  onConsumeCapturedSelection,
  layoutMode = "side-panel",
  onLayoutModeChange,
  variant = "side-panel",
}: NotebookAiPanelProps) {
  const isFullscreen = variant === "fullscreen";
  const layoutIsFullscreen = isFullscreenAiLayout(layoutMode);

  const { width, onDragHandleMouseDown } = usePanelWidth();
  const requestCurrentPageIdRef = useRef<string | null>(null);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isApplyingTransform, setIsApplyingTransform] = useState(false);
  const [composerRevision, setComposerRevision] = useState(0);
  // 打开面板时解析会话：6 小时未活跃的旧会话归档进历史，展示空白新会话。
  // 页面引用 / 图片附件仍由 Composer 管理，用户可随时点叉移除。
  const [conversationId, setConversationId] = useState(() =>
    useNotebookAiChats.getState().ensureFreshActiveConversation(notebookId),
  );
  // 初次打开和新建会话时锁定当时的当前页，作为可见、可移除的默认上下文。
  const initialReference = useMemo(() => {
    const pageId = getCurrentNotebookAiPageId(notebookId);
    const page = pageId ? usePages.getState().pages[pageId] : undefined;
    return page
      ? buildAiFileReferenceAttrs(page, useNotebooks.getState().notebooks)
      : null;
  }, [notebookId, composerRevision]);

  // 检查模型是否可用（用于引导文案）
  const modelCheck = buildLanguageModel();

  // 持久化消息
  const persistedMessages = useMemo(
    () =>
      useNotebookAiChats
        .getState()
        .getConversationMessages(notebookId, conversationId),
    [notebookId, conversationId],
  );

  // useChat 只在 chat id 改变时重建 Chat；transport 必须保持稳定，
  // 并在真正发送时再绑定本轮最新的页签上下文。
  const transport = useMemo<ChatTransport<NotebookAiMessage>>(
    () => ({
      async sendMessages(options) {
        const currentPageId =
          requestCurrentPageIdRef.current ??
          getCurrentNotebookAiPageId(notebookId);
        const result = buildTransport(notebookId, currentPageId);
        if (!result.ok) {
          throw new Error(result.reason);
        }

        return result.transport.sendMessages({
          ...options,
          messages: prepareNotebookAiMessagesForModel(options.messages),
        });
      },
      async reconnectToStream(options) {
        const currentPageId =
          requestCurrentPageIdRef.current ??
          getCurrentNotebookAiPageId(notebookId);
        const result = buildTransport(notebookId, currentPageId);
        if (!result.ok) {
          throw new Error(result.reason);
        }
        return result.transport.reconnectToStream(options);
      },
    }),
    [notebookId],
  );

  const {
    messages,
    sendMessage,
    status,
    stop,
    setMessages,
    error,
    clearError,
  } = useChat<NotebookAiMessage>({
    transport,
    id: `notebook-ai-${notebookId}-${conversationId}`,
    messages: persistedMessages,
    onFinish: ({ messages: finishedMessages }) => {
      const cleanedMessages = sanitizeNotebookAiMessages(finishedMessages);
      useNotebookAiChats
        .getState()
        .setMessages(notebookId, conversationId, cleanedMessages);
      queueMicrotask(() => setMessages(cleanedMessages));
    },
  });

  const isStreaming = status === "streaming" || status === "submitted";
  const isBusy = isStreaming || isApplyingTransform;
  const unavailableReason = !modelCheck.ok ? modelCheck.reason : undefined;
  const stopRef = useRef(stop);
  const aiStatusActiveRef = useRef(false);
  stopRef.current = stop;

  // Notebook AI 的真实请求生命周期同步到页头图标：提交/生成时进入运行态，
  // 正常结束触发一次完成反馈，错误或卸载则安静复位。
  useEffect(() => {
    if (isStreaming) {
      if (!aiStatusActiveRef.current) {
        aiStatusActiveRef.current = true;
        useAiStatus.getState().beginStreaming();
      }
      return;
    }

    if (!aiStatusActiveRef.current) return;
    aiStatusActiveRef.current = false;
    useAiStatus
      .getState()
      .finishStreaming({ celebrate: status === "ready" && !error });
  }, [error, isStreaming, status]);

  useEffect(
    () => () => {
      if (!aiStatusActiveRef.current) return;
      aiStatusActiveRef.current = false;
      useAiStatus.getState().reset();
    },
    [],
  );

  useEffect(() => {
    setMessages(
      useNotebookAiChats
        .getState()
        .getConversationMessages(notebookId, conversationId),
    );
    clearError();
    requestCurrentPageIdRef.current = null;
  }, [notebookId, conversationId, setMessages, clearError]);

  useEffect(() => {
    if (unavailableReason || isBusy) return;

    const timer = window.setInterval(() => {
      setPlaceholderIndex(
        (index) => (index + 1) % NOTEBOOK_AI_PLACEHOLDER_HINTS.length,
      );
    }, 4500);

    return () => window.clearInterval(timer);
  }, [unavailableReason, isBusy]);

  // 流式写入页面
  useEffect(() => {
    if (!isStreaming) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;

    for (const part of lastMsg.parts ?? []) {
      if (part.type === "tool-createPage" || part.type === "tool-updatePage") {
        void handleStreamingWritePart(part as StreamingWritePart, {
          notebookId,
          currentPageId: requestCurrentPageIdRef.current,
        });
      }
    }
  }, [messages, isStreaming, notebookId]);

  // 组件卸载时清理 writer session
  useEffect(() => {
    return () => {
      stopRef.current();
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg || lastMsg.role !== "assistant") return;
      for (const part of lastMsg.parts ?? []) {
        if (
          part.type === "tool-createPage" ||
          part.type === "tool-updatePage"
        ) {
          const toolCallId = (part as Record<string, unknown>).toolCallId as
            | string
            | undefined;
          if (toolCallId) cleanupWriterSession(toolCallId);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePanelKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.stopPropagation();
      onClose();
    },
    [onClose],
  );

  const composerPlaceholder = unavailableReason
    ? "请先在设置中配置 AI 模型"
    : isBusy
      ? "正在生成结果…"
      : NOTEBOOK_AI_PLACEHOLDER_HINTS[placeholderIndex];

  const handleSend = useCallback(
    (
      payload: AiComposerPayload,
      imageAttachments: NotebookAiImageAttachment[],
    ) => {
      if (isBusy || unavailableReason) return false;

      const displayText = payload.promptText.trim();
      if (!displayText && imageAttachments.length === 0) return false;
      const requestPayload = displayText
        ? payload
        : {
            ...payload,
            promptText: "请分析用户上传的图片。",
            freeformText: "",
          };

      const currentPageId = getCurrentNotebookAiPageId(notebookId);
      const transformIntent =
        imageAttachments.length === 0
          ? resolveBlockTypeTransformIntent(displayText)
          : null;
      const { modelText, metadata } = buildNotebookAiUserMessage({
        payload: requestPayload,
        notebookId,
        currentPageId,
        useImplicitPage: false,
      });
      metadata.displayText = displayText || "已上传图片";
      metadata.imageAttachments = imageAttachments.map(({ file }) => ({
        filename: file.name,
        mediaType: file.type || "image/*",
      }));
      const cleanedMessages = sanitizeNotebookAiMessages(messages);

      if (transformIntent) {
        if (!currentPageId) {
          toast.error("请先打开要转换的页面。");
          return false;
        }
        if (
          payload.references.some(
            (reference) =>
              Boolean(reference.pageId) && reference.pageId !== currentPageId,
          )
        ) {
          toast.error(
            "待办转换不能同时指向其它页面；请先打开目标页，或移除 @ 引用。",
          );
          return false;
        }

        const page = usePages.getState().pages[currentPageId];
        const targetError = getTransformTargetError(page, notebookId);
        if (targetError) {
          toast.error(targetError);
          return false;
        }
        if (!page) return false;

        let snapshot: BlockTypeTransformSelectionSnapshot;

        try {
          if (capturedSelection) {
            if (
              capturedSelection.version !== 1 ||
              capturedSelection.pageId !== currentPageId ||
              !isBlockTypeTransformSelectionSnapshot(
                capturedSelection.selection,
              ) ||
              capturedSelection.selection.pageId !== currentPageId
            ) {
              throw new Error("选中的内容已不在当前页面，请重新选择后再试。");
            }
            snapshot = capturedSelection.selection;
          } else {
            if (!hasWholePageBlockTypeTransformScope(displayText)) {
              throw new Error(
                "请先选中要转换的完整内容，或明确输入“把当前页全部内容改成待办事项”。",
              );
            }
            const activeEditor = editorRef?.current?.editor;
            const currentBlocks =
              activeEditor && usePages.getState().activePageId === currentPageId
                ? (activeEditor.document as BlockTypeTransformBlock[])
                : getPageBlocks(page.content);
            snapshot = createPageBodyBlockTypeTransformSnapshot(
              currentPageId,
              currentBlocks,
              { protectFirstTitle: !page.localFilePath },
            );
          }
        } catch (error) {
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : "无法确定待办事项转换范围，页面未修改。",
          );
          return false;
        }

        const userMessage = {
          id: createChatMessageId("user"),
          role: "user",
          metadata,
          parts: [{ type: "text", text: modelText }],
        } as NotebookAiMessage;
        const pendingMessages = [...cleanedMessages, userMessage];

        requestCurrentPageIdRef.current = null;
        clearError();
        setMessages(pendingMessages);
        useNotebookAiChats
          .getState()
          .setMessages(notebookId, conversationId, pendingMessages);
        onConsumeCapturedSelection?.();
        setIsApplyingTransform(true);

        void (async () => {
          let assistantText: string;

          try {
            const latestPage = usePages.getState().pages[currentPageId];
            const latestTargetError = getTransformTargetError(
              latestPage,
              notebookId,
            );
            if (latestTargetError) throw new Error(latestTargetError);

            const activeEditor = editorRef?.current?.editor;
            const isTargetEditorActive =
              Boolean(activeEditor) &&
              usePages.getState().activePageId === currentPageId &&
              getCurrentNotebookAiPageId(notebookId) === currentPageId;
            let convertedCount: number;

            if (activeEditor && isTargetEditorActive) {
              const result = applyBlockTypeTransformToEditor(
                activeEditor,
                snapshot,
              );
              const saved = await usePages
                .getState()
                .writePageContent(
                  currentPageId,
                  activeEditor.document as JSONContent,
                );
              if (!saved) {
                throw new Error("转换结果未能保存，未完成本轮操作。");
              }
              convertedCount = result.convertedCount;
            } else {
              const plan = planBlockTypeTransform(
                snapshot,
                getPageBlocks(latestPage?.content),
              );
              const saved = await usePages
                .getState()
                .replaceBlockRange(
                  currentPageId,
                  plan.startBlockId,
                  plan.endBlockId,
                  plan.replacementBlocks as JSONContent,
                );
              if (!saved) {
                throw new Error("目标内容已变化，未转换待办事项。");
              }
              convertedCount = plan.convertedCount;
            }

            assistantText = `已转换为 ${convertedCount} 个原生待办事项。`;
            toast.success(assistantText);
          } catch (error) {
            const reason =
              error instanceof Error && error.message
                ? error.message
                : "转换待办事项失败，页面未修改。";
            assistantText = `未完成转换：${reason}`;
            toast.error(reason);
          }

          const assistantMessage = {
            id: createChatMessageId("assistant"),
            role: "assistant",
            parts: [{ type: "text", text: assistantText }],
          } as NotebookAiMessage;
          const finishedMessages = sanitizeNotebookAiMessages([
            ...pendingMessages,
            assistantMessage,
          ]);
          useNotebookAiChats
            .getState()
            .setMessages(notebookId, conversationId, finishedMessages);
          setMessages(finishedMessages);
          setIsApplyingTransform(false);
        })();

        return true;
      }

      requestCurrentPageIdRef.current = currentPageId;
      if (cleanedMessages !== messages) {
        setMessages(cleanedMessages);
        useNotebookAiChats
          .getState()
          .setMessages(notebookId, conversationId, cleanedMessages);
      }

      clearError();
      void sendMessage({
        text: modelText,
        files: createImageFileList(imageAttachments),
        metadata,
      });
      onConsumeCapturedSelection?.();
      return true;
    },
    [
      isBusy,
      unavailableReason,
      notebookId,
      conversationId,
      messages,
      setMessages,
      clearError,
      sendMessage,
      capturedSelection,
      editorRef,
      onConsumeCapturedSelection,
    ],
  );

  const persistCurrentConversation = useCallback(() => {
    useNotebookAiChats
      .getState()
      .setMessages(
        notebookId,
        conversationId,
        sanitizeNotebookAiMessages(messages),
      );
  }, [notebookId, conversationId, messages]);

  const handleNewConversation = useCallback(() => {
    if (isBusy) return;
    persistCurrentConversation();
    clearError();
    requestCurrentPageIdRef.current = null;
    onConsumeCapturedSelection?.();
    const nextConversationId = useNotebookAiChats
      .getState()
      .createConversation(notebookId);
    setComposerRevision((revision) => revision + 1);
    setConversationId(nextConversationId);
    setMessages([]);
  }, [
    isBusy,
    persistCurrentConversation,
    clearError,
    notebookId,
    setMessages,
    onConsumeCapturedSelection,
  ]);

  const handleSelectConversation = useCallback(
    (nextConversationId: string) => {
      if (isBusy || nextConversationId === conversationId) return;
      persistCurrentConversation();
      const chats = useNotebookAiChats.getState();
      chats.setActiveConversation(notebookId, nextConversationId);
      const nextMessages = chats.getConversationMessages(
        notebookId,
        nextConversationId,
      );
      clearError();
      requestCurrentPageIdRef.current = null;
      onConsumeCapturedSelection?.();
      setConversationId(nextConversationId);
      setMessages(nextMessages);
    },
    [
      isBusy,
      conversationId,
      notebookId,
      clearError,
      setMessages,
      persistCurrentConversation,
      onConsumeCapturedSelection,
    ],
  );

  const searchPages = useCallback(
    (query: string) => getNotebookAiReferenceSuggestions(query, notebookId),
    [notebookId],
  );

  const handleBatchApproval = useCallback(
    async (response: BatchApprovalResponse) => {
      const replaceToolPart = (
        state:
          | "approval-responded"
          | "output-available"
          | "output-denied"
          | "output-error",
        payload: { output?: unknown; errorText?: string } = {},
      ) => {
        const nextMessages = messages.map((message) => ({
          ...message,
          parts: (message.parts ?? []).map((part) => {
            if (
              !(
                typeof part === "object" &&
                part &&
                "toolCallId" in part &&
                part.toolCallId === response.toolCallId
              )
            ) {
              return part;
            }
            return {
              ...part,
              state,
              ...(payload.output !== undefined
                ? { output: payload.output }
                : {}),
              ...(payload.errorText ? { errorText: payload.errorText } : {}),
              approval: {
                id: response.approvalId,
                approved: response.approved,
                reason: response.approved
                  ? `用户批准执行 ${response.selectedOperationIds.length} 项操作`
                  : "用户取消了整批计划",
              },
            } as unknown as typeof part;
          }),
        })) as NotebookAiMessage[];
        const cleanedMessages = sanitizeNotebookAiMessages(nextMessages);
        setMessages(cleanedMessages);
        useNotebookAiChats
          .getState()
          .setMessages(notebookId, conversationId, cleanedMessages);
      };

      if (!response.approved) {
        replaceToolPart("output-denied");
        return;
      }

      const journal = updateBatchPlanSelection(
        response.toolCallId,
        response.runId,
        response.selectedOperationIds,
      );
      if (!journal) {
        toast.error("批量计划已失效，请让 AI 重新生成计划。");
        return;
      }

      replaceToolPart("approval-responded");
      try {
        const result = await executePreparedBatchPlan(
          response.toolCallId,
          response.runId,
        );
        const appliedCount = result.results.filter((item) => item.ok).length;
        replaceToolPart("output-available", {
          output: {
            ok: result.ok,
            toolCallId: response.toolCallId,
            runId: response.runId,
            status: result.journal.status,
            appliedCount,
            selectedCount: result.journal.selectedOperationIds.length,
            canUndo: result.ok && result.journal.status === "completed",
            ...(result.ok ? {} : { error: result.error }),
            results: result.results,
          },
        });
      } catch (executeError) {
        replaceToolPart("output-error", {
          errorText:
            executeError instanceof Error
              ? executeError.message
              : "批量计划执行失败",
        });
      }
    },
    [conversationId, messages, notebookId, setMessages],
  );

  const handleBatchUndo = useCallback(
    async (toolCallId: string, runId: string): Promise<BatchUndoResult> => {
      try {
        const result = await undoBatchPlan(toolCallId, runId);
        if (!result.ok) {
          toast.error("无法完整撤回本批变更", {
            description: result.error,
          });
          return {
            ok: false,
            status: result.journal.status,
            conflictCount: result.journal.status === "undo-conflicted" ? 1 : 0,
            error: result.error,
          };
        }

        const pageIds = new Set(
          result.results.flatMap((operation) => operation.pageIds),
        );
        pageIds.forEach(reloadEditorIfActive);
        const nextMessages = messages.map((message) => ({
          ...message,
          parts: (message.parts ?? []).map((part) => {
            if (
              !(
                typeof part === "object" &&
                part &&
                "toolCallId" in part &&
                part.toolCallId === toolCallId &&
                "output" in part &&
                part.output &&
                typeof part.output === "object"
              )
            ) {
              return part;
            }
            return {
              ...part,
              output: {
                ...(part.output as Record<string, unknown>),
                status: "undone",
                canUndo: false,
              },
            } as unknown as typeof part;
          }),
        })) as NotebookAiMessage[];
        const cleanedMessages = sanitizeNotebookAiMessages(nextMessages);
        setMessages(cleanedMessages);
        useNotebookAiChats
          .getState()
          .setMessages(notebookId, conversationId, cleanedMessages);
        toast.success("已撤回本批变更");
        return {
          ok: true,
          status: "reverted",
          revertedCount: result.results.filter((operation) => operation.ok)
            .length,
        };
      } catch (undoError) {
        const description =
          undoError instanceof Error ? undoError.message : "请稍后重试。";
        toast.error("撤回失败", { description });
        return { ok: false, error: description };
      }
    },
    [conversationId, messages, notebookId, setMessages],
  );

  // 获取正在流式的消息 id
  const streamingMessageId =
    isStreaming && messages.length > 0
      ? messages[messages.length - 1].id
      : undefined;

  // 会话标题只在历史列表展示；全屏时工具栏上移到 PageHeader 右上角（顶替 PageMenu）
  // 顺序：新建 → 更多 → 关闭，避免「✓ ×」或「× +」像确认/取消对话框
  const headerToolbar = useMemo(() => {
    const iconBtn =
      "flex h-7 w-7 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-[var(--goose-interactive-hover)] hover:text-foreground disabled:pointer-events-none disabled:opacity-50";
    return (
      <div className="flex items-center gap-0.5" role="toolbar" aria-label="AI 工具栏">
        <button
          type="button"
          onClick={handleNewConversation}
          className={iconBtn}
          aria-label="新建会话"
          title="新建会话"
          disabled={isBusy}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={iconBtn}
              aria-label="更多选项"
              title="更多"
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="w-56">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <HistoryIcon className="h-4 w-4" strokeWidth={1.75} />
                <span>历史会话</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-72 max-w-72 overflow-hidden p-0">
                <div className="px-3 py-2.5">
                  <div className="text-sm font-medium text-foreground">
                    历史会话
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    切换当前笔记本的 AI 会话
                  </div>
                </div>
                <ConversationHistoryList
                  notebookId={notebookId}
                  onSelectConversation={handleSelectConversation}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {onLayoutModeChange ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>打开方式</DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={() => onLayoutModeChange("side-panel")}
                  className="gap-2"
                >
                  <PanelRight className="h-4 w-4" strokeWidth={1.75} />
                  <span className="flex-1">侧栏并排</span>
                  {!layoutIsFullscreen ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2} />
                  ) : null}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => onLayoutModeChange("fullscreen")}
                  className="gap-2"
                >
                  <AppWindow className="h-4 w-4" strokeWidth={1.75} />
                  <span className="flex-1">全屏</span>
                  {layoutIsFullscreen ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2} />
                  ) : null}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={onClose}
          className={iconBtn}
          aria-label="关闭 AI"
          title="关闭 AI"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    );
  }, [
    onClose,
    handleNewConversation,
    isBusy,
    notebookId,
    handleSelectConversation,
    onLayoutModeChange,
    layoutIsFullscreen,
  ]);

  // 全屏：工具栏挂到标签栏右上角；侧栏并排：仍在面板内右上角
  useEffect(() => {
    if (!isFullscreen) {
      clearAiHeaderActions();
      return;
    }
    setAiHeaderActions(headerToolbar);
    return () => {
      clearAiHeaderActions();
    };
  }, [isFullscreen, headerToolbar]);

  return (
    <div
      onKeyDown={handlePanelKeyDown}
      className={cn(
        "relative flex h-full min-w-0 flex-col overflow-hidden bg-[hsl(var(--goose-editor-bg))]",
        // 侧栏：独立卡片；全屏：铺满主区域，与编辑器表面一体
        isFullscreen ? "w-full flex-1 rounded-none" : "rounded-[12px]",
      )}
      style={isFullscreen ? undefined : { width }}
    >
      {/* 侧栏模式才显示拖宽手柄 */}
      {!isFullscreen ? (
        <div
          className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-[var(--goose-interactive-hover)]"
          onMouseDown={onDragHandleMouseDown}
          aria-hidden="true"
        />
      ) : null}

      {/* 侧栏并排：面板内右上角工具栏（无左侧标题）。全屏时工具栏已挂到 PageHeader */}
      {!isFullscreen ? (
        <div className="flex h-12 shrink-0 items-center justify-end gap-1 px-2.5">
          {headerToolbar}
        </div>
      ) : null}

      {/* 消息区 / 引导区 */}
      {unavailableReason ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="flex max-w-[260px] flex-col items-center gap-3 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--goose-interactive-hover)] text-muted-foreground">
              <CircleAlert className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <p className="text-sm font-medium text-foreground">AI 暂不可用</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {unavailableReason}
            </p>
          </div>
        </div>
      ) : (
        <ChatMessages
          messages={messages}
          streamingMessageId={streamingMessageId}
          editorRef={editorRef}
          layout={isFullscreen ? "fullscreen" : "side-panel"}
          onBatchApproval={handleBatchApproval}
          onBatchUndo={handleBatchUndo}
        />
      )}

      {error ? (
        <div className={cn("mb-2 w-full", isFullscreen ? "px-6" : "px-3")}>
          {/*
            全实色语义 token，不用 bg-destructive/10、text-foreground/85：
            uTools 旧内核对 hsl(var(--x)/a) 会回退成异常实色，文字看不清。
          */}
          <div
            className={cn(
              "flex items-start gap-2 rounded-[10px] border border-[var(--goose-color-danger-focus)] bg-[var(--goose-color-danger-subtle-bg)] px-3 py-2.5 text-xs",
              isFullscreen && "mx-auto max-w-[720px]",
            )}
            role="alert"
          >
            <CircleAlert
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--goose-color-danger-focus)]"
              strokeWidth={1.75}
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[var(--goose-color-danger-focus)]">
                本轮失败原因
              </div>
              <div className="mt-0.5 break-words leading-relaxed text-foreground">
                {formatChatError(error)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => clearError()}
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[var(--goose-color-danger-focus)] outline-none transition-colors hover:bg-[var(--goose-interactive-hover)]"
              aria-label="关闭错误提示"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      ) : null}

      {/* 输入框 */}
      <Composer
        key={`${notebookId}-${composerRevision}`}
        onSend={handleSend}
        onStop={stop}
        isStreaming={isBusy}
        disabled={!!unavailableReason}
        placeholder={composerPlaceholder}
        searchPages={searchPages}
        onEscape={onClose}
        initialReference={initialReference}
        layout={isFullscreen ? "fullscreen" : "side-panel"}
      />
    </div>
  );
}
