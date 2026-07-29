import { useEditorState } from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";

export const NON_FORMATTABLE_TYPES = new Set([
  "image",
  "file",
  "audio",
  "video",
  "divider",
  "table",
  "codeBlock",
]);

export const BOOLEAN_MARK_NAMES = [
  "bold",
  "italic",
  "strike",
  "underline",
  "code",
] as const;
export type BooleanMarkName = (typeof BOOLEAN_MARK_NAMES)[number];

/**
 * Walk the selection so partial-coverage marks register as inactive.
 * BlockNote's useActiveStyles() only inspects selection.$to which misses ranges.
 */
export function useSelectionMarkStates(editor: BlockNoteEditor<any, any, any>) {
  return useEditorState({
    editor,
    selector: ({ editor }) => {
      const { selection, doc } = editor.prosemirrorState;
      const from = selection.from;
      const to = selection.to;

      const result: Record<BooleanMarkName, boolean> = {
        bold: false,
        italic: false,
        strike: false,
        underline: false,
        code: false,
      };

      if (from === to) {
        const marks = selection.$to.marks();
        for (const name of BOOLEAN_MARK_NAMES) {
          result[name] = marks.some((m: any) => m.type.name === name);
        }
        return result;
      }

      const counts: Record<BooleanMarkName, { with: number; total: number }> = {
        bold: { with: 0, total: 0 },
        italic: { with: 0, total: 0 },
        strike: { with: 0, total: 0 },
        underline: { with: 0, total: 0 },
        code: { with: 0, total: 0 },
      };

      doc.nodesBetween(from, to, (node: any) => {
        if (!node.isText) return true;
        for (const name of BOOLEAN_MARK_NAMES) {
          counts[name].total += 1;
          if (node.marks.some((m: any) => m.type.name === name)) {
            counts[name].with += 1;
          }
        }
        return false;
      });

      for (const name of BOOLEAN_MARK_NAMES) {
        result[name] =
          counts[name].total > 0 && counts[name].with === counts[name].total;
      }
      return result;
    },
  });
}

function selectionTouchesTable(selection: any): boolean {
  const hasTableAncestor = ($pos: any) => {
    if (!$pos) return false;
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.spec?.tableRole) return true;
    }
    return false;
  };

  if (hasTableAncestor(selection.$from) || hasTableAncestor(selection.$to)) {
    return true;
  }

  if (selection.$anchorCell || selection.$headCell) return true;

  let touchesTable = false;
  selection.content?.().content.descendants((node: any) => {
    if (node.type.spec?.tableRole || node.type.name === "table") {
      touchesTable = true;
    }
    return !touchesTable;
  });

  return touchesTable;
}

/**
 * 选区是否完全落在同一个不可格式化块内（代码块、图片、视频等）。
 * 仅整段选区都在该块内时禁用工具栏；跨块混合选区（含 Cmd+A 全选）照常显示，
 * 避免「文档里有一个代码块就无法全选加粗」。
 *
 * 直读 prosemirrorState（与 selectionTouchesTable 同模式）：
 * BlockNote 的 getSelection()/getTextCursorPosition() 在 useEditorState
 * selector 回调里可能因事务重入抛错，不能依赖。PM 节点名与 block type 同名。
 */
export function selectionHasNonFormattableBlock(
  editor: BlockNoteEditor<any, any, any>,
): boolean {
  const { selection } = editor.prosemirrorState;

  const nearestNonFormattable = ($pos: any) => {
    for (let d = $pos.depth; d > 0; d -= 1) {
      const node = $pos.node(d);
      if (NON_FORMATTABLE_TYPES.has(node.type.name)) return node;
    }
    return null;
  };

  const fromNode = nearestNonFormattable(selection.$from);
  if (!fromNode) return false;
  return fromNode === nearestNonFormattable(selection.$to);
}

/**
 * 选区是否完全落在标题一（文档物理首块、heading level 1）内部。
 * 跨块选区（含 Cmd+A 全选）返回 false，保证全选时工具栏可用。
 * 虚拟标题不在 BlockNote 文档里，调用方应按 contentMode 自行豁免。
 */
export function selectionIsInsideFirstTitleBlock(
  editor: BlockNoteEditor<any, any, any>,
): boolean {
  const { selection, doc } = editor.prosemirrorState;
  // doc > blockGroup > blockContainer
  const firstContainer = doc.firstChild?.firstChild ?? null;
  if (!firstContainer) return false;

  const nearestContainer = ($pos: any) => {
    for (let d = $pos.depth; d > 0; d -= 1) {
      const node = $pos.node(d);
      if (node.type.name === "blockContainer") return node;
    }
    return null;
  };

  const fromContainer = nearestContainer(selection.$from);
  if (!fromContainer || fromContainer !== nearestContainer(selection.$to)) {
    return false;
  }
  if (fromContainer !== firstContainer) return false;

  const contentNode = fromContainer.firstChild;
  return (
    contentNode?.type.name === "heading" && contentNode.attrs?.level === 1
  );
}

/**
 * 选区是否完全落在 heading 块内部（任意 level 1-6，文档任意位置）。
 * 跨块混合选区（含 Cmd+A 全选）返回 false，保证全选时不误伤。
 * 用于禁用 heading 内的字符级样式（bold/italic/underline/strike/code）。
 */
export function selectionIsInsideHeadingBlock(
  editor: BlockNoteEditor<any, any, any>,
): boolean {
  const { selection } = editor.prosemirrorState;
  const nearestContainer = ($pos: any) => {
    for (let d = $pos.depth; d > 0; d -= 1) {
      const node = $pos.node(d);
      if (node.type.name === "blockContainer") return node;
    }
    return null;
  };
  const fromContainer = nearestContainer(selection.$from);
  if (!fromContainer || fromContainer !== nearestContainer(selection.$to)) {
    return false;
  }
  const contentNode = fromContainer.firstChild;
  return contentNode?.type.name === "heading";
}

export function shouldRenderFormattingToolbar(
  editor: BlockNoteEditor<any, any, any>,
) {
  const { selection, doc } = editor.prosemirrorState;

  if (selection.empty) return false;
  if (doc.textBetween(selection.from, selection.to).length === 0) return false;
  // 表格内选区暂不暴露——BlockNote FormattingToolbarController 的 store 和
  // position 选择子在 cell 选择下无法稳定再开（pointerup 链路被 prosemirror-tables
  // 截获，setState 后 useEditorState 也不会重新计算 position）。
  // 走自有 Popover 方案的代价较大，目前保留原行为：表格内编辑直接走右键菜单。
  if (selectionTouchesTable(selection)) return false;
  // 代码块或其它 NON_FORMATTABLE_TYPES 内选中时直接禁用工具栏（第一道闸）。
  if (selectionHasNonFormattableBlock(editor)) return false;

  return true;
}

/**
 * 选区是否完全落在同一个表格单元格内（保留 helper 供未来扩展）。
 */
export function isSelectionInsideSingleCell(selection: any): boolean {
  const $from = selection.$from;
  const $to = selection.$to;
  if (!$from || !$to) return false;
  const fromCell = findAncestorOfRole($from, "cell");
  const toCell = findAncestorOfRole($to, "cell");
  if (!fromCell || !toCell) return false;
  return fromCell.depth === toCell.depth && fromCell.pos === toCell.pos;
}

function findAncestorOfRole(
  $pos: any,
  role: "cell" | "row" | "table",
): { depth: number; pos: number } | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node?.type?.spec?.tableRole === role) {
      return { depth: d, pos: $pos.before(d) };
    }
  }
  return null;
}
