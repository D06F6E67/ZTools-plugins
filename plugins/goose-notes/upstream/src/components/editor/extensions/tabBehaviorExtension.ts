import { createExtension } from "@blocknote/core";
import {
  addRowAfter,
  goToNextCell,
  isInTable,
} from "prosemirror-tables";
import type { EditorView } from "prosemirror-view";

const handleTableTab = (view: EditorView, direction: 1 | -1): boolean => {
  if (!isInTable(view.state)) return false;

  if (goToNextCell(direction)(view.state, view.dispatch)) {
    view.focus();
    return true;
  }

  // 末尾单元格：先新增一行，再跳到下一格
  if (direction === 1 && addRowAfter(view.state, view.dispatch)) {
    goToNextCell(1)(view.state, view.dispatch);
    view.focus();
    return true;
  }

  return true;
};

function isInCodeBlock(editor: {
  getTextCursorPosition: () => { block: { type: string } };
}): boolean {
  try {
    return editor.getTextCursorPosition().block.type === "codeBlock";
  } catch {
    return false;
  }
}

/**
 * Tab / Shift-Tab：
 * - 表格内：单元格导航
 * - 代码块内：放行给代码缩进扩展
 * - 可嵌套 / 可提升时：放行给 BlockNote 默认 nest/unnest
 *   （任意块类型，含段落嵌到列表项下成为子项）
 * - 否则消费 Tab，避免焦点跳出编辑器
 */
export const gooseTabBehaviorExtension = createExtension({
  key: "goose-tab-behavior",
  keyboardShortcuts: {
    Tab: ({ editor }) => {
      const view = editor.prosemirrorView;
      if (view && handleTableTab(view, 1)) {
        return true;
      }
      if (isInCodeBlock(editor)) {
        return false;
      }
      if (editor.canNestBlock()) {
        return false;
      }
      return true;
    },
    "Shift-Tab": ({ editor }) => {
      const view = editor.prosemirrorView;
      if (view && handleTableTab(view, -1)) {
        return true;
      }
      if (isInCodeBlock(editor)) {
        return false;
      }
      if (editor.canUnnestBlock()) {
        return false;
      }
      return true;
    },
  },
});
