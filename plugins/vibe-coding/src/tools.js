/**
 * 创建 OpenAI 兼容的函数工具定义。
 * @param {string} name 工具函数名称。
 * @param {string} description 工具用途说明。
 * @param {Record<string, unknown>} properties 参数属性定义。
 * @param {string[]} required 必填参数名称。
 * @returns {Record<string, unknown>} 函数工具定义。
 */
const functionTool = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  },
})

export const TOOL_GROUPS = [
  {
    id: 'files',
    label: 'File Operations',
    tools: [
      functionTool('read', '读取文本文件或图片。文本默认最多返回 2000 行或 50 KB，可使用 offset/limit 按行继续；图片会在模型支持视觉时作为图片内容提供。编辑前必须先读取。', {
        path: { type: 'string', description: '文件绝对路径，或相对于当前工作区/默认工作区根目录的路径。' },
        offset: { type: 'integer', description: '从第几行开始读取，从 1 开始。', minimum: 1 },
        limit: { type: 'integer', description: '最多读取多少行，最大 2000。', minimum: 1, maximum: 2000 },
      }, ['path']),
      functionTool('write', '创建或完整覆盖本机文本文件，并自动创建父目录。', {
        path: { type: 'string', description: '文件绝对路径，或相对于当前工作区/默认工作区根目录的路径。' },
        content: { type: 'string', description: '要写入的完整文件内容。' },
      }, ['path', 'content']),
      functionTool('edit', '对单个文件执行一组原子的精确文本替换。每个 oldText 必须在原文件中唯一匹配，修改区域不能重叠；调用前必须先 read。', {
        path: { type: 'string', description: '文件绝对路径，或相对于当前工作区/默认工作区根目录的路径。' },
        edits: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: {
            type: 'object',
            properties: {
              oldText: { type: 'string', description: '必须唯一匹配的原始文本。' },
              newText: { type: 'string', description: '替换后的文本。' },
            },
            required: ['oldText', 'newText'],
            additionalProperties: false,
          },
        },
      }, ['path', 'edits']),
    ],
  },
  {
    id: 'search',
    label: 'Search',
    tools: [
      functionTool('grep', '使用 ripgrep 搜索文件内容，返回文件路径、行号和匹配文本；遵循 .gitignore。', {
        pattern: { type: 'string', description: '正则表达式或字面量搜索词。' },
        path: { type: 'string', description: '可选文件或目录，默认当前工作区。' },
        glob: { type: 'string', description: '可选文件 Glob，例如 **/*.vue。' },
        ignoreCase: { type: 'boolean', description: '是否忽略大小写，默认 false。' },
        literal: { type: 'boolean', description: '是否按字面量而不是正则搜索，默认 false。' },
        context: { type: 'integer', description: '匹配前后附带的上下文行数，最大 20。', minimum: 0, maximum: 20 },
        limit: { type: 'integer', description: '最大匹配数量，默认 100。', minimum: 1, maximum: 1000 },
      }, ['pattern']),
      functionTool('find', '使用 fd 按 Glob 查找文件和目录；遵循 .gitignore。', {
        pattern: { type: 'string', description: 'Glob 模式，例如 **/*.vue。' },
        path: { type: 'string', description: '可选搜索目录，默认当前工作区。' },
        limit: { type: 'integer', description: '最大结果数量，默认 1000。', minimum: 1, maximum: 10000 },
      }, ['pattern']),
      functionTool('ls', '列出单层目录内容，包含隐藏文件，目录名称以 / 结尾。', {
        path: { type: 'string', description: '可选目录，默认当前工作区。' },
        limit: { type: 'integer', description: '最大条目数量，默认 500。', minimum: 1, maximum: 5000 },
      }),
    ],
  },
  {
    id: 'shell',
    label: 'Shell Executor',
    tools: [
      functionTool('bash', '执行本机 Shell 命令并实时返回过程输出。绑定工作区时默认在工作区执行，否则默认在插件数据目录的 workspace/ 子目录执行。开发服务器等长任务必须设置 background=true。', {
        command: { type: 'string' },
        background: { type: 'boolean', description: '后台执行时立即返回任务标识，不应用前台超时。', default: false },
        timeoutMs: {
          type: 'integer',
          description: '前台命令超时时间，单位毫秒。默认 120000（120 秒），最大 600000（10 分钟）。不要传入秒数。',
          minimum: 1000,
          maximum: 600000,
          default: 120000,
        },
      }, ['command']),
      functionTool('list_background_shells', '列出 ZVC 启动的后台 Shell 进程。'),
      functionTool('read_background_shell_output', '读取后台 Shell 的输出。', {
        shell_id: { type: 'string' }, offset: { type: 'integer' },
      }, ['shell_id']),
      functionTool('kill_background_shell', '终止一个后台 Shell 进程。', {
        shell_id: { type: 'string' },
      }, ['shell_id']),
    ],
  },
  {
    id: 'tasks',
    label: 'Task Manager',
    tools: [
      functionTool('task_read', '读取当前会话的任务清单。任务仅属于本会话，并在新一轮用户消息开始时清空。'),
      functionTool('task_write', '覆盖当前会话的完整任务清单。每次必须提交完整列表，不能只提交变化项。', {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            },
            required: ['content', 'status'],
            additionalProperties: false,
          },
        },
      }, ['tasks']),
    ],
  },
  {
    id: 'web',
    label: 'Web Toolkit',
    tools: [
      functionTool('builtin_web_search', '搜索互联网并返回网页标题、链接和摘要。回答中必须引用结果链接。', {
        query: { type: 'string', description: '搜索关键词。' },
        count: { type: 'integer', description: '返回结果数量，默认 5，最多 10。' },
        language: { type: 'string', description: '语言或地区代码，例如 zh-CN、en-US、ja。默认 zh-CN。' },
      }, ['query']),
      functionTool('builtin_web_fetch', '读取并提取指定网页的正文。用户提供 URL 或搜索结果需要深入阅读时使用。', {
        url: { type: 'string', description: '以 http:// 或 https:// 开头的网页地址。' },
        offset: { type: 'integer', description: '从正文的字符位置开始读取，默认 0。' },
        length: { type: 'integer', description: '读取字符数，默认 30000，最多 30000。' },
      }, ['url']),
    ],
  },
]

export const ALL_TOOLS = TOOL_GROUPS.flatMap((group) => group.tools)

/**
 * 工具执行调度模式；只读工具允许同组并行，有副作用工具默认独占。
 * @typedef {'parallel'|'exclusive'} ToolExecutionMode
 */

const PARALLEL_TOOL_NAMES = new Set([
  'read',
  'grep',
  'find',
  'ls',
  'task_read',
  'builtin_web_search',
  'builtin_web_fetch',
  'list_background_shells',
  'read_background_shell_output',
])

/**
 * 获取工具的内部并发执行模式，未知工具采用独占策略并失败关闭。
 * @param {unknown} toolName 工具函数名称。
 * @returns {ToolExecutionMode} 工具执行模式。
 */
export function getToolExecutionMode(toolName) {
  return PARALLEL_TOOL_NAMES.has(String(toolName || '')) ? 'parallel' : 'exclusive'
}

export const GENERAL_TOOLS = TOOL_GROUPS
  .filter((group) => group.id === 'web')
  .flatMap((group) => group.tools)
// 普通会话保持纯对话；用户可在能力面板手动启用 Web 或本地工具。
export const DEFAULT_ENABLED_TOOLS = []
export const PLUGIN_DEVELOPMENT_TOOL_GROUPS = new Set(['files', 'search', 'shell', 'tasks', 'web'])
export const BASE_SYSTEM_PROMPT = `你是 ZVC，一名全能 AI 助手。

你可以回答问题、分析资料、搜索网页、整理信息，并使用当前会话中启用的工具。

工作规则：
1. 只使用当前会话明确启用的工具；没有启用的能力不可调用。
2. 除非用户明确要求，否则不要修改文件、运行命令或创建工作区内容。
3. 涉及有副作用的操作时，先说明将要做什么，并根据工具确认状态执行。
4. 不要因为当前绑定了工作区，就自动进行插件开发。
5. 如果用户的问题不需要工具，直接回答，不要为了调用工具而调用工具。
6. 用用户能理解的中文说明结果、限制和仍需用户决定的问题。`

/**
 * 根据当前工作区构建会话系统提示词。
 * @param {{project?: Record<string, unknown>|null}} options 会话工作区上下文。
 * @param {Record<string, unknown>|null} options.project 当前绑定工作区。
 * @returns {string} 系统提示词。
 */
export function buildSystemPrompt({ project = null } = {}) {
  const sections = [BASE_SYSTEM_PROMPT]
  if (project) {
    sections.push(`当前会话工作区：${project.name}\n工作区路径：${project.path}\nShell 命令和相对文件路径默认以该工作区为基准；用户明确指定绝对路径时可以访问其他非敏感本机路径。`)
  } else {
    sections.push('当前会话未绑定工作区。Shell 命令和相对文件路径默认以插件数据目录的 workspace/ 子目录为基准，也可以使用绝对路径访问非敏感本机位置。')
  }
  return sections.join('\n\n')
}
