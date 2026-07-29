import type { NotebookAiMessage } from "./types";

const INPUT_ONLY_TOOL_STATES = new Set([
  "call",
  "partial-call",
  "input-streaming",
  "input-available",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isNotebookAiToolPart(part: unknown): part is {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  toolCallId?: string;
} {
  return (
    isObject(part) &&
    typeof part.type === "string" &&
    part.type.startsWith("tool-")
  );
}

function shouldDropFinishedToolPart(part: unknown) {
  if (!isNotebookAiToolPart(part)) return false;
  const state = part.state ?? "";
  const hasTerminalPayload =
    state === "output-available" ||
    state === "output-error" ||
    state === "output-denied" ||
    part.output !== undefined ||
    Boolean(part.errorText);

  return INPUT_ONLY_TOOL_STATES.has(state) && !hasTerminalPayload;
}

function hasModelRelevantPart(part: unknown) {
  if (!isObject(part) || typeof part.type !== "string") return false;
  if (part.type === "step-start") return false;
  return true;
}

export function sanitizeNotebookAiMessages(
  messages: NotebookAiMessage[],
): NotebookAiMessage[] {
  const nextMessages: NotebookAiMessage[] = [];
  let changed = false;

  for (const message of messages) {
    const parts = message.parts ?? [];
    const nextParts = parts.filter((part) => !shouldDropFinishedToolPart(part));

    if (nextParts.length !== parts.length) changed = true;

    if (message.role === "assistant" && !nextParts.some(hasModelRelevantPart)) {
      changed = true;
      continue;
    }

    nextMessages.push(
      nextParts === parts
        ? message
        : ({
            ...message,
            parts: nextParts,
          } as NotebookAiMessage),
    );
  }

  return changed ? nextMessages : messages;
}

/**
 * 批量计划由应用本地确定性执行，不需要模型再次消费这类工具调用。
 * 兼容源可能要求供应商私有的 thought_signature；发送下一轮对话时移除
 * 批量工具 part，同时保留本地持久化消息中的审批与撤回记录。
 */
export function prepareNotebookAiMessagesForModel(
  messages: NotebookAiMessage[],
): NotebookAiMessage[] {
  const sanitized = sanitizeNotebookAiMessages(messages);
  const nextMessages: NotebookAiMessage[] = [];

  for (const message of sanitized) {
    const parts = message.parts ?? [];
    const nextParts = parts.filter(
      (part) =>
        !(isNotebookAiToolPart(part) && part.type === "tool-executeBatchPlan"),
    );

    if (message.role === "assistant" && !nextParts.some(hasModelRelevantPart)) {
      continue;
    }

    nextMessages.push(
      nextParts.length === parts.length
        ? message
        : ({ ...message, parts: nextParts } as NotebookAiMessage),
    );
  }

  return nextMessages;
}

/**
 * 图片会作为 data URL 暂存在 AI SDK 的 file part 中。会话写入本地存储前必须
 * 移除二进制内容：它既会放大存储，也会在后续每轮无意间重复上传旧图片。
 * 附件名称和类型保留在 metadata.imageAttachments，供历史记录提示用户。
 */
export function prepareNotebookAiMessagesForPersistence(
  messages: NotebookAiMessage[],
): NotebookAiMessage[] {
  const sanitized = sanitizeNotebookAiMessages(messages);
  let changed = sanitized !== messages;

  const nextMessages = sanitized.map((message) => {
    const parts = message.parts ?? [];
    const nextParts = parts.filter((part) => part.type !== "file");
    if (nextParts.length === parts.length) return message;
    changed = true;
    return {
      ...message,
      parts: nextParts,
    } as NotebookAiMessage;
  });

  return changed ? nextMessages : sanitized;
}
