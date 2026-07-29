import { ToolLoopAgent, generateText, stepCountIs } from "ai";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { blocksToMarkdown } from "@/lib/export/blocknoteSerializer";
import { buildLanguageModel } from "./model";
import { notebookAiTools } from "./tools";
import {
  getSkillToolNames,
  NOTEBOOK_AGENT_INSTRUCTIONS,
  NOTEBOOK_SKILLS,
} from "./skills";
import { getCurrentNotebookAiPageId } from "./context";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import type { LanguageModel } from "ai";
import type { ModelAvailability } from "./model";
import type { NotebookAiAgentContext } from "./types";

/** 只注入当前任务所需的稳定上下文，具体能力由 loadSkill 渐进加载。 */
function buildSystemPrompt(
  notebookId: string,
  currentPageId?: string | null,
): string {
  const notebook = useNotebooks.getState().notebooks[notebookId];
  const notebookName = notebook?.name ?? "未知笔记本";

  const pages = usePages.getState().pages;
  const activePageId = currentPageId ?? getCurrentNotebookAiPageId(notebookId);
  const activePage =
    activePageId && pages[activePageId]?.workspaceId === notebookId
      ? pages[activePageId]
      : undefined;
  const activePageLine =
    activePage && !activePage.trashedAt
      ? `[${activePage.id}] ${getPageTitle(activePage)}`
      : "（无当前打开页面）";

  return `${NOTEBOOK_AGENT_INSTRUCTIONS}

# 当前上下文

- 当前笔记本：${notebookName}
- 当前笔记本 id：${notebookId}
- 当前打开页面：${activePageLine}

先判断本轮需求是否在路由能力内。然后调用 loadSkill 加载最匹配的 Skill，再执行。`;
}

function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const obj = part as Record<string, unknown>;
      if (typeof obj.text === "string") return obj.text;
      if (typeof obj.content === "string") return obj.content;
      if (typeof obj.output === "string") return obj.output;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function getLastUserRequest(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown> | undefined;
    if (msg?.role !== "user") continue;
    const text = textFromMessageContent(msg.content);
    if (text.trim()) return text.trim();
  }
  return "";
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return (match?.[1] ?? trimmed).trim();
}

function findMentionedMarkdownSection(
  markdown: string,
  userRequest: string,
): string {
  const headings = [...markdown.matchAll(/^(#{2,6})\s+(.+?)\s*$/gm)].map(
    (match) => ({
      level: match[1].length,
      title: match[2].trim(),
      index: match.index ?? 0,
    }),
  );
  if (headings.length === 0) return "";

  const normalizedRequest = userRequest.replace(/\s+/g, "");
  const target =
    headings.find((heading) =>
      normalizedRequest.includes(heading.title.replace(/\s+/g, "")),
    ) ??
    headings.find(
      (heading) =>
        heading.title.includes("示例") && normalizedRequest.includes("示例"),
    );
  if (!target) return "";

  const next = headings.find(
    (heading) => heading.index > target.index && heading.level <= target.level,
  );
  return markdown.slice(target.index, next?.index ?? markdown.length).trimEnd();
}

async function repairUpdatePageToolCall(options: {
  toolCall: {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    input: string;
    [key: string]: unknown;
  };
  messages: unknown[];
  model: LanguageModel;
  currentPageId?: string | null;
}) {
  const activePageId =
    options.currentPageId ?? usePages.getState().activePageId;
  const page = activePageId
    ? usePages.getState().pages[activePageId]
    : undefined;
  if (!activePageId || !page) return null;

  const userRequest = getLastUserRequest(options.messages);
  const title = getPageTitle(page);
  const currentMarkdown = await blocksToMarkdown(
    page.content as BlockNoteContent,
  );

  const result = await generateText({
    model: options.model,
    prompt: `${NOTEBOOK_SKILLS.updateNote.content}

# 工具调用修复

- 上一次 updatePage 缺少 markdown。
- 只输出新的正文 Markdown。
- 不输出 JSON 或代码围栏。
- 不重复页面标题。

用户请求：
${userRequest || "按用户最近的要求更新当前页面"}

页面标题：
${title}

当前页面 Markdown：
${currentMarkdown}`,
  });

  const markdown = stripMarkdownFence(result.text);
  if (!markdown) return null;

  return {
    ...options.toolCall,
    input: JSON.stringify({ pageId: activePageId, markdown }),
  };
}

async function repairReplaceInPageToolCall(options: {
  toolCall: {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    input: string;
    [key: string]: unknown;
  };
  messages: unknown[];
  currentPageId?: string | null;
}) {
  const activePageId =
    options.currentPageId ?? usePages.getState().activePageId;
  const page = activePageId
    ? usePages.getState().pages[activePageId]
    : undefined;
  if (!activePageId || !page) return null;

  const userRequest = getLastUserRequest(options.messages);
  const currentMarkdown = await blocksToMarkdown(
    page.content as BlockNoteContent,
  );
  const section = findMentionedMarkdownSection(currentMarkdown, userRequest);
  if (!section) {
    return {
      ...options.toolCall,
      input: JSON.stringify({ pageId: activePageId, find: "", replace: "" }),
    };
  }

  return {
    ...options.toolCall,
    input: JSON.stringify({ pageId: activePageId, find: section, replace: "" }),
  };
}

export type BuildAgentResult =
  | { ok: true; agent: ToolLoopAgent<never, typeof notebookAiTools> }
  | { ok: false; reason: string };

/**
 * 构建绑定指定笔记本的 ToolLoopAgent。
 * 每次调用都会重新构建以获取最新的笔记本上下文。
 */
export function buildNotebookAgent(
  notebookId: string,
  currentPageId?: string | null,
): BuildAgentResult {
  const agentContext: NotebookAiAgentContext = {
    notebookId,
    currentPageId: currentPageId ?? getCurrentNotebookAiPageId(notebookId),
    loadedSkills: new Set(),
  };
  const modelResult: ModelAvailability = buildLanguageModel();
  if (!modelResult.ok) {
    return { ok: false, reason: modelResult.reason };
  }

  const agent = new ToolLoopAgent({
    model: modelResult.model,
    tools: notebookAiTools,
    instructions: buildSystemPrompt(notebookId, agentContext.currentPageId),
    stopWhen: stepCountIs(16),
    experimental_context: agentContext,
    prepareStep: () => {
      const activeTools = [
        "loadSkill",
        ...getSkillToolNames(agentContext.loadedSkills),
      ] as Array<keyof typeof notebookAiTools>;
      return { activeTools };
    },
    experimental_repairToolCall: async (options) => {
      if (options.toolCall.toolName === "updatePage") {
        try {
          const parsed = JSON.parse(options.toolCall.input || "{}") as {
            markdown?: unknown;
          };
          if (typeof parsed.markdown === "string" && parsed.markdown.trim()) {
            return null;
          }
        } catch {
          // 继续走修复：坏 JSON 和空 markdown 都按同一条链路处理。
        }

        return repairUpdatePageToolCall({
          toolCall: options.toolCall,
          messages: options.messages,
          model: modelResult.model,
          currentPageId: agentContext.currentPageId,
        });
      }

      if (options.toolCall.toolName === "replaceInPage") {
        try {
          const parsed = JSON.parse(options.toolCall.input || "{}") as {
            find?: unknown;
          };
          if (typeof parsed.find === "string" && parsed.find.trim()) {
            return null;
          }
        } catch {
          // 继续走修复：坏 JSON 和空 find 都按同一条链路处理。
        }

        return repairReplaceInPageToolCall({
          toolCall: options.toolCall,
          messages: options.messages,
          currentPageId: agentContext.currentPageId,
        });
      }

      return null;
    },
  });

  return { ok: true, agent };
}
