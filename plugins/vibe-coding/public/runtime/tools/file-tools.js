const fs = require('node:fs');
const path = require('node:path');

const MAX_READ_FILE_BYTES = 20 * 1024 * 1024;
const MAX_WRITE_FILE_BYTES = 1024 * 1024;
const MAX_READ_LINES = 2000;
const MAX_READ_BYTES = 50 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

/**
 * 创建 Pi 风格的文件读取、写入和精确编辑工具。
 * @param {{resolvePath: Function, getAttachmentStore: Function, createPresentedResult: Function, computeDiffs: Function, resolveLanguage: Function, createLines: Function}} dependencies 文件工具依赖。
 * @returns {{execute: Function}} 文件工具执行接口。
 */
function createFileTools(dependencies) {
  const mutationQueues = new Map();

  /**
   * 将同一文件的写入任务串行化，避免并行工具覆盖彼此结果。
   * @param {string} filePath 文件绝对路径。
   * @param {() => Promise<unknown>|unknown} operation 文件变更操作。
   * @returns {Promise<unknown>} 当前变更操作结果。
   */
  function withFileMutationQueue(filePath, operation) {
    const previous = mutationQueues.get(filePath) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    mutationQueues.set(filePath, current);
    return current.finally(() => {
      if (mutationQueues.get(filePath) === current) mutationQueues.delete(filePath);
    });
  }

  /**
   * 读取受限大小的 UTF-8 文本文件。
   * @param {string} filePath 文件绝对路径。
   * @returns {string} 文件文本。
   * @throws {Error} 文件不存在、不是普通文件或超过读取上限时抛出。
   */
  function readTextFile(filePath) {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('目标不是普通文件');
    if (stat.size > MAX_READ_FILE_BYTES) throw new Error('文件超过 20 MB，请使用 Shell 或其他分段工具处理');
    return fs.readFileSync(filePath, 'utf8');
  }

  /**
   * 从指定一基行号开始构建满足行数和字节上限的文本窗口。
   * @param {string} content 完整文件文本。
   * @param {number} offset 起始行号，从 1 开始。
   * @param {number} limit 最大行数。
   * @returns {{lines: string[], startLine: number, totalLines: number, truncated: boolean, nextOffset: number|null}} 文本窗口。
   */
  function createReadWindow(content, offset, limit) {
    const allLines = String(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const startLine = Math.min(Math.max(1, Number(offset) || 1), Math.max(1, allLines.length));
    const requestedLimit = Math.min(Math.max(1, Number(limit) || MAX_READ_LINES), MAX_READ_LINES);
    const lines = [];
    let bytes = 0;
    for (let index = startLine - 1; index < allLines.length && lines.length < requestedLimit; index += 1) {
      const lineBytes = Buffer.byteLength(`${allLines[index]}${lines.length ? '\n' : ''}`, 'utf8');
      if (lines.length && bytes + lineBytes > MAX_READ_BYTES) break;
      if (!lines.length && lineBytes > MAX_READ_BYTES) {
        lines.push(Buffer.from(allLines[index], 'utf8').subarray(0, MAX_READ_BYTES).toString('utf8'));
        bytes = MAX_READ_BYTES;
        break;
      }
      lines.push(allLines[index]);
      bytes += lineBytes;
    }
    const consumedThrough = startLine - 1 + lines.length;
    const truncated = consumedThrough < allLines.length;
    return { lines, startLine, totalLines: allLines.length, truncated, nextOffset: truncated ? consumedThrough + 1 : null };
  }

  /**
   * 读取文本或图片，并生成模型结果与专用展示卡片。
   * @param {Record<string, unknown>} args 工具参数。
   * @param {Record<string, unknown>|null} workspace 当前工作区。
   * @param {{supportsImages?: boolean}} context 当前模型能力上下文。
   * @returns {Record<string, unknown>} 文件读取结果信封。
   * @throws {Error} 路径、文件类型或文件内容无效时抛出。
   */
  function read(args, workspace, context) {
    const filePath = dependencies.resolvePath(workspace, args.path);
    const extension = path.extname(filePath).toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension)) {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) throw new Error('图片文件不存在');
      const reference = dependencies.getAttachmentStore().saveImage({ bytes: fs.readFileSync(filePath), name: path.basename(filePath) });
      const supportsImages = context.supportsImages === true;
      return dependencies.createPresentedResult(
        {
          path: filePath,
          type: 'image',
          width: reference.width,
          height: reference.height,
          mediaType: reference.mediaType,
          message: supportsImages ? '图片已作为视觉内容提供给模型。' : '当前模型不支持图片输入，图片仅在工具卡片中展示。',
        },
        { card: 'image', path: filePath, attachment: reference },
        supportsImages ? [{ type: 'text', text: `已读取图片：${filePath}（${reference.width}×${reference.height}）` }, { type: 'image', attachment: reference }] : [],
      );
    }

    const content = readTextFile(filePath);
    const window = createReadWindow(content, Number(args.offset), Number(args.limit));
    const visibleText = window.lines.join('\n');
    const notice = window.truncated ? `\n\n[显示第 ${window.startLine}-${window.startLine + window.lines.length - 1} 行，共 ${window.totalLines} 行。请使用 offset=${window.nextOffset} 继续读取。]` : '';
    return dependencies.createPresentedResult(
      {
        path: filePath,
        content: `${visibleText}${notice}`,
        startLine: window.startLine,
        totalLines: window.totalLines,
        truncated: window.truncated,
        nextOffset: window.nextOffset,
      },
      {
        card: 'read',
        path: filePath,
        lang: dependencies.resolveLanguage(filePath),
        lines: dependencies.createLines(visibleText, window.startLine),
        totalLines: window.totalLines,
      },
    );
  }

  /**
   * 创建或完整覆盖文本文件，并返回真实差异。
   * @param {Record<string, unknown>} args 工具参数。
   * @param {Record<string, unknown>|null} workspace 当前工作区。
   * @returns {Promise<Record<string, unknown>>} 文件写入结果信封。
   * @throws {Error} 内容超过上限或目标路径无效时抛出。
   */
  async function write(args, workspace) {
    const filePath = dependencies.resolvePath(workspace, args.path);
    const content = String(args.content ?? '');
    if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_FILE_BYTES) throw new Error('单次写入不能超过 1 MB');
    return withFileMutationQueue(filePath, () => {
      const before = fs.existsSync(filePath) ? readTextFile(filePath) : '';
      // 父目录与正文作为一次受管变更写入，避免暴露任意文件系统 API。
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
      return dependencies.createPresentedResult(
        { ok: true, path: filePath, bytes: Buffer.byteLength(content, 'utf8') },
        { card: 'diff', path: filePath, diffs: dependencies.computeDiffs(filePath, before, content) },
      );
    });
  }

  /**
   * 统计目标文本在正文中的非重叠匹配位置。
   * @param {string} content 完整正文。
   * @param {string} needle 待匹配文本。
   * @returns {number[]} 每个匹配的起始字符位置。
   */
  function findOccurrences(content, needle) {
    const positions = [];
    let cursor = 0;
    while (cursor <= content.length - needle.length) {
      const index = content.indexOf(needle, cursor);
      if (index < 0) break;
      positions.push(index);
      cursor = index + Math.max(1, needle.length);
    }
    return positions;
  }

  /**
   * 使用多个唯一且不重叠的文本替换原子编辑单个文件。
   * @param {Record<string, unknown>} args 工具参数。
   * @param {Record<string, unknown>|null} workspace 当前工作区。
   * @returns {Promise<Record<string, unknown>>} 编辑结果信封。
   * @throws {Error} 修改为空、匹配不唯一、区域重叠或文件无效时抛出。
   */
  async function edit(args, workspace) {
    const filePath = dependencies.resolvePath(workspace, args.path);
    const edits = Array.isArray(args.edits) ? args.edits : [];
    if (!edits.length || edits.length > 100) throw new Error('edits 必须包含 1 到 100 个修改块');
    return withFileMutationQueue(filePath, () => {
      const rawContent = readTextFile(filePath);
      const bom = rawContent.startsWith('\uFEFF') ? '\uFEFF' : '';
      const withoutBom = bom ? rawContent.slice(1) : rawContent;
      const lineEnding = withoutBom.includes('\r\n') ? '\r\n' : '\n';
      const normalized = withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const replacements = edits.map((item, index) => {
        const oldText = String(item?.oldText ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const newText = String(item?.newText ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (!oldText) throw new Error(`edits[${index}].oldText 不能为空`);
        const occurrences = findOccurrences(normalized, oldText);
        if (occurrences.length !== 1) throw new Error(`edits[${index}].oldText 必须唯一匹配，当前匹配 ${occurrences.length} 处`);
        return { start: occurrences[0], end: occurrences[0] + oldText.length, newText };
      }).sort((left, right) => left.start - right.start);
      for (let index = 1; index < replacements.length; index += 1) {
        if (replacements[index].start < replacements[index - 1].end) throw new Error('多个编辑区域发生重叠，请合并后重试');
      }
      let next = normalized;
      // 从后向前应用字符位置，避免前面的替换改变后续坐标。
      for (const replacement of [...replacements].reverse()) {
        next = `${next.slice(0, replacement.start)}${replacement.newText}${next.slice(replacement.end)}`;
      }
      const restored = bom + (lineEnding === '\r\n' ? next.replace(/\n/g, '\r\n') : next);
      fs.writeFileSync(filePath, restored, 'utf8');
      return dependencies.createPresentedResult(
        { ok: true, path: filePath, replacements: replacements.length },
        { card: 'diff', path: filePath, diffs: dependencies.computeDiffs(filePath, rawContent, restored) },
      );
    });
  }

  /**
   * 分发一个文件类工具调用。
   * @param {'read'|'write'|'edit'} toolName 工具名称。
   * @param {Record<string, unknown>} args 工具参数。
   * @param {Record<string, unknown>|null} workspace 当前工作区。
   * @param {Record<string, unknown>} context 当前模型上下文。
   * @returns {Promise<Record<string, unknown>>} 工具结果信封。
   * @throws {Error} 工具名称未知或执行失败时抛出。
   */
  async function execute(toolName, args, workspace, context = {}) {
    if (toolName === 'read') return read(args, workspace, context);
    if (toolName === 'write') return write(args, workspace);
    if (toolName === 'edit') return edit(args, workspace);
    throw new Error(`未知文件工具：${toolName}`);
  }

  return { execute };
}

module.exports = {
  MAX_READ_BYTES,
  MAX_READ_LINES,
  createFileTools,
};
