import {
  useBlockNoteEditor,
  useSelectedBlocks,
  useEditorState,
  useExtension,
} from "@blocknote/react";
import { AIExtension } from "@blocknote/xl-ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { TextSelection } from "prosemirror-state";
import { TooltipProvider } from "@/components/editor/ui/tooltip";
import { Separator } from "@/components/editor/ui/separator";
import { cn } from "@/components/editor/utils/cn";
import {
  useEditorPageContext,
  useEditorSettings,
} from "@/components/editor/platform/hostContext";
import { useContextMenu } from "@/components/editor/state/contextMenu";
import { useGlobalScrollActivity } from "@/components/editor/hooks/useGlobalScrollActivity";
import { useFormattingToolbarAi } from "@/components/editor/state/formattingToolbarAi";
import { FormattingToolbarColorPicker } from "@/components/editor/toolbars/formatting/ColorPicker";
import { setFakeSelection } from "@/components/editor/extensions/fakeSelectionExtension";
import {
  selectionHasNonFormattableBlock,
  selectionIsInsideFirstTitleBlock,
  selectionIsInsideHeadingBlock,
  shouldRenderFormattingToolbar,
  useSelectionMarkStates,
} from "@/components/editor/toolbars/formatting/helpers";
import type { BindTooltip } from "@/components/editor/toolbars/formatting/ToolbarTooltip";
import { AiButton } from "@/components/editor/toolbars/formatting/groups/AiButton";
import { toast } from "@/components/ui/sonner";
import { MarkGroup } from "@/components/editor/toolbars/formatting/groups/MarkGroup";
import { InlineGroup } from "@/components/editor/toolbars/formatting/groups/InlineGroup";
import { LinkButton } from "@/components/editor/toolbars/formatting/groups/LinkButton";
import { AlignGroup } from "@/components/editor/toolbars/formatting/groups/AlignGroup";
import { ClearFormatButton } from "@/components/editor/toolbars/formatting/groups/ClearFormatButton";

export { shouldRenderFormattingToolbar };

export function EditorFormattingToolbar() {
  const editor = useBlockNoteEditor();
  // 未启用 AI 的构建跳过 useExtension；编译期分支在同一构建内保持稳定。
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const aiExtension = __GOOSE_EDITOR_AI__
    ? useExtension(AIExtension)
    : undefined;
  const { ai: aiSettings } = useEditorSettings();
  const { contentMode } = useEditorPageContext();
  const protectsFirstTitle = contentMode === "normalized";
  const markStates = useSelectionMarkStates(editor);
  const selectedBlocks = useSelectedBlocks();

  const selectionState = useEditorState({
    editor,
    selector: ({ editor }) => {
      const { selection, doc } = editor.prosemirrorState;

      const selectedText = doc
        .textBetween(selection.from, selection.to, "\n", "\n")
        .trim();

      return {
        hasTextSelection: !selection.empty && selectedText.length > 0,
        hasNonFormattableBlock: selectionHasNonFormattableBlock(editor),
      };
    },
  });

  // 仅 normalized 文档把物理首块 H1 视为受保护的页面标题。
  const isInTitleOne = useEditorState({
    editor,
    selector: ({ editor }) =>
      protectsFirstTitle && selectionIsInsideFirstTitleBlock(editor),
  });

  const isInHeading = useEditorState({
    editor,
    selector: ({ editor }) => selectionIsInsideHeadingBlock(editor),
  });

  const aiActive = useFormattingToolbarAi((s) => s.active);
  const setAiActive = useFormattingToolbarAi((s) => s.setActive);

  const openMenuId = useContextMenu((state) => state.openMenuId);
  const isContextMenuOpen = Boolean(openMenuId);
  const scrollActivity = useGlobalScrollActivity({ idleMs: 120 });
  const isScrolling = scrollActivity.isScrolling;

  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null);

  const bindTooltip = useCallback<BindTooltip>(
    (id) => ({
      delayDuration: 400,
      open: activeTooltip === id,
      onOpenChange: (open) =>
        setActiveTooltip((prev) => (open ? id : prev === id ? null : prev)),
    }),
    [activeTooltip],
  );

  useEffect(() => {
    if (!menuRef.current) return;
    menuRef.current.style.zIndex = "20000";
  }, []);

  useEffect(() => {
    if (!isScrolling && !isContextMenuOpen) return;
    setActiveTooltip(null);
  }, [isScrolling, isContextMenuOpen]);

  // Clear AI mode + fake selection on unmount (e.g. when toolbar unmounts)
  useEffect(() => {
    return () => {
      if (savedSelectionRef.current) {
        try {
          setFakeSelection(editor, null);
        } catch {
          /* ignore */
        }
      }
      setAiActive(false);
    };
  }, [editor, setAiActive]);

  // xl-ai 接管：旧自家 AiPanel 不再触发，AI 按钮改为打开 xl-ai 的 AIMenu。
  // 保留 selection 保存逻辑（用于聚焦/退出还原），但跳过 setAiActive。
  const handleAiActivate = useCallback(() => {
    try {
      const { selection } = editor.prosemirrorState;
      if (selection.empty) return;

      if (!aiSettings.enabled) {
        toast.error("AI 助手尚未开启，请先到设置中打开");
        return;
      }
      const apiKey = (
        aiSettings.customProtocol === "openai-responses"
          ? aiSettings.customOpenAIResponsesApiKey
          : aiSettings.customProtocol === "openai"
            ? aiSettings.customOpenAIApiKey
            : aiSettings.customClaudeApiKey
      ).trim();
      if (!apiKey) {
        toast.error(
          '未填写 API Key。请前往"设置 → AI 助手 → AI 服务"检查配置。',
        );
        return;
      }
      const hasModel =
        aiSettings.selectedModelId?.trim() ||
        aiSettings.customModelOptions[0]?.id;
      if (!hasModel) {
        toast.error("请先保存 AI 服务配置并获取模型列表");
        return;
      }

      const saved = { from: selection.from, to: selection.to };
      savedSelectionRef.current = saved;
      setFakeSelection(editor, saved);

      const blockId = editor.getTextCursorPosition().block.id;
      setActiveTooltip(null);
      aiExtension?.openAIMenuAtBlock(blockId);
    } catch {
      /* ignore */
    }
  }, [editor, aiExtension, aiSettings]);

  const handleAiClose = useCallback(() => {
    const savedSel = savedSelectionRef.current;
    try {
      setFakeSelection(editor, null);
    } catch {
      /* ignore */
    }
    savedSelectionRef.current = null;
    setAiActive(false);

    // 把 ProseMirror 选区恢复到原始范围并把焦点交还给 editor。
    // 否则点击空白后 editor 失焦：1) 选区高亮消失；2) Mod-z 快捷键
    // 进不到 ProseMirror，导致撤销整体失灵。
    if (savedSel) {
      requestAnimationFrame(() => {
        try {
          const view = (editor as any).prosemirrorView;
          if (!view) return;
          const { state } = view;
          const docSize = state.doc.content.size;
          const from = Math.min(savedSel.from, docSize);
          const to = Math.min(savedSel.to, docSize);
          if (from !== to) {
            const tr = state.tr.setSelection(
              TextSelection.create(state.doc, from, to),
            );
            tr.setMeta("addToHistory", false);
            view.dispatch(tr);
          }
          view.focus();
        } catch {
          /* ignore */
        }
      });
    }
  }, [editor, setAiActive]);

  const isBold = markStates.bold;
  const isItalic = markStates.italic;
  const isStrike = markStates.strike;
  const isUnderline = markStates.underline;
  const isCode = markStates.code;

  const firstBlock = selectedBlocks[0];
  const textAlignment =
    (firstBlock?.props as { textAlignment?: string } | undefined)
      ?.textAlignment ?? "left";

  const linkUrl = editor.getSelectedLinkUrl();
  const isLinkActive = !!linkUrl;

  const setTextAlignment = useCallback(
    (alignment: "left" | "center" | "right") => {
      // 多块逐个 updateBlock 会产生 N 个 undo 步骤，transact 合并成一步整体撤销
      editor.transact(() => {
        for (const block of selectedBlocks) {
          editor.updateBlock(block, {
            props: { textAlignment: alignment },
          });
        }
      });
    },
    [editor, selectedBlocks],
  );

  const clearFormatting = useCallback(() => {
    editor.transact(() => {
      editor.removeStyles({
        bold: true,
        italic: true,
        underline: true,
        strike: true,
        code: true,
        textColor: true,
        backgroundColor: true,
      } as any);
      for (const block of selectedBlocks) {
        editor.updateBlock(block, {
          props: { textAlignment: "left" },
        });
      }
    });
  }, [editor, selectedBlocks]);

  // 小窗的格式栏是固定底栏，滚动不会遮挡选区，也不应闪烁隐藏；
  // 常规笔记本的浮动栏仍在滚动时收起，避免与正文一起漂移。
  const shouldHideForScroll =
    (!__GOOSE_EDITOR_COMPACT__ && isScrolling) || isContextMenuOpen;
  // While AI is active we keep the toolbar visible regardless of scroll/menu.
  const shouldHide = !aiActive && shouldHideForScroll;

  // Selection-based gating only matters when AI mode isn't already active.
  if (
    !aiActive &&
    (!selectionState.hasTextSelection ||
      selectionState.hasNonFormattableBlock ||
      isInTitleOne)
  ) {
    return null;
  }

  return (
    <TooltipProvider
      delayDuration={400}
      skipDelayDuration={0}
      disableHoverableContent
    >
      <div
        ref={menuRef}
        data-formatting-toolbar
        onMouseDown={(e) => {
          // Allow native focus on the AI textarea; everything else uses onClick.
          const target = e.target as HTMLElement | null;
          if (!target) return;
          if (target.tagName === "TEXTAREA" || target.tagName === "INPUT")
            return;
          if (target.isContentEditable) return;
          e.preventDefault();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className={cn(
          "z-[20000] rounded-[10px] border border-border/75 bg-popover shadow-[0_8px_22px_rgba(15,23,42,0.1),0_1px_3px_rgba(15,23,42,0.06)] transition-[opacity,transform,width] duration-150 ease-out dark:border-white/15 dark:bg-[#2f3437]",
          aiActive ? "w-[520px] max-w-[calc(100vw-24px)]" : "w-auto",
        )}
        style={{
          opacity: shouldHide ? 0 : 1,
          transform: shouldHide ? "scale(0.96)" : "scale(1)",
          pointerEvents: shouldHide ? "none" : "auto",
        }}
      >
        <div className="flex items-center gap-0.5 p-1">
          {__GOOSE_EDITOR_AI__ && aiSettings.enabled && (
            <>
              <AiButton
                onActivate={handleAiActivate}
                bindTooltip={bindTooltip}
              />
              <Separator
                orientation="vertical"
                className="h-5 opacity-70 mx-0.5"
              />
            </>
          )}

          <MarkGroup
            isBold={isBold}
            isItalic={isItalic}
            isStrike={isStrike}
            bindTooltip={bindTooltip}
            hideMarks={isInHeading}
          />

          <FormattingToolbarColorPicker />

          <InlineGroup
            isUnderline={isUnderline}
            isCode={isCode}
            bindTooltip={bindTooltip}
            hideMarks={isInHeading}
          />

          {!isInHeading && (
            <Separator orientation="vertical" className="h-5 opacity-70" />
          )}

          <LinkButton
            isLinkActive={isLinkActive}
            linkUrl={linkUrl}
            bindTooltip={bindTooltip}
          />

          <Separator orientation="vertical" className="h-5 opacity-70" />

          <AlignGroup
            textAlignment={textAlignment}
            setTextAlignment={setTextAlignment}
            bindTooltip={bindTooltip}
          />

          <Separator orientation="vertical" className="h-5 opacity-70" />

          <ClearFormatButton
            onClear={clearFormatting}
            bindTooltip={bindTooltip}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
