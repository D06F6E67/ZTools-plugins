import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { FormattingToolbarExtension } from "@blocknote/core/extensions";
import {
  FilePanelController,
  FormattingToolbarController,
  LinkToolbarController,
  SuggestionMenuController,
  TableHandlesController,
  useEditorState,
  useExtensionState,
} from "@blocknote/react";
import {
  flip as floatingFlip,
  offset as floatingOffset,
  shift as floatingShift,
} from "@floating-ui/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import {
  clonePageContent,
  getContentSignature,
  type BlockNoteContent,
} from "@/components/editor/utils/blocknote-content";
import { CustomSlashMenu } from "@/components/editor/core/CustomSlashMenu";
import {
  EditorFormattingToolbar,
  shouldRenderFormattingToolbar,
} from "@/components/editor/toolbars/formatting";
import { FixedFormattingToolbarController } from "@/components/editor/toolbars/formatting/FixedFormattingToolbarController";
import { AIExtension, AIMenuController } from "@blocknote/xl-ai";
import { GooseAIMenu } from "@/components/editor/ai/GooseAIMenu";
import { useFormattingToolbarAi } from "@/components/editor/state/formattingToolbarAi";
import { EditorSideMenu } from "@/components/editor/core/EditorSideMenu";
import { ImageLightbox } from "@/components/editor/image/ImageLightbox";
import { EditorLinkToolbar } from "@/components/editor/toolbars/link/EditorLinkToolbar";
import { FindInPageBar } from "@/components/editor/find/FindInPageBar";
import { closeAllOverlays } from "@/lib/closeAllOverlays";
import { useSettings } from "@/stores/useSettings";

// Sub-component and modular utility imports
import { EditorFilePanel } from "@/components/editor/menus/EditorFilePanel";
import {
  GooseTableHandle,
  GooseTableExtendButton,
} from "@/components/editor/menus/GooseTableHandle";
import { EditorContextMenu } from "@/components/editor/menus/EditorContextMenu";
import { editorSchema } from "@/components/editor/core/schema";
import { shouldOpenSlashSuggestionMenu } from "@/components/editor/utils/slashMenuPolicy";
import { getCompactSlashMenuFloatingOptions } from "@/components/editor/utils/compactSlashMenuFloating";
import { LocalFileTitle } from "@/pages/workspace/components/page/LocalFileTitle";
import {
  useEditorPageContext,
  useEditorSettings,
} from "@/components/editor/platform/hostContext";

// Re-exports to prevent broken imports elsewhere
export {
  normalizeClipboardLineEndings,
  looksLikeMarkdownFragment,
  stripMarkdownHardBreaks,
  normalizeMarkdownPasteText,
  parseMarkdownLink,
  shouldPreferVisibleSelectionText,
  isValidUrl,
} from "@/components/editor/utils/clipboard";

export {
  isBottomEditorBlankClick,
  getSelectedPlainTextContext,
  getSelectedCellPlainText,
  getSelectedImageUrl,
  getElementFromNode,
  isInteractiveEditorTarget,
} from "@/components/editor/utils/selection";

export { editorSchema } from "@/components/editor/core/schema";

type EditorComposerProps = {
  editor: any;
  editable: boolean;
  page: any;
  editorContainerRef: RefObject<HTMLDivElement | null>;
  handleEditorBlankMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleEditorPasteCapture: (
    event: React.ClipboardEvent<HTMLDivElement>,
  ) => void;
  getSlashItems: (query: string) => Promise<any[]>;
  pageIdForUpdateRef: RefObject<string | null>;
  syncedContentSignatureRef: RefObject<string | null>;
  debouncedUpdate: ((id: string) => void) & { cancel: () => void };
  /** 自上次程序化同步（切页/外部重载）以来用户是否真实交互过（见 Editor.tsx 意图门控）。 */
  userInteractedRef: RefObject<boolean>;
  /** 静默同步 store（不标脏、不入保存队列）：用于编辑器初始化后的异步 props 补全。 */
  silentContentSync: (content: BlockNoteContent) => void;
  isEditorFullWidth: boolean;
  effectiveTheme: "light" | "dark";
  tableEvenColumnWidth: boolean;
  searchProviders: any[];
  customActions: any[];
  /** 是否渲染块侧边菜单（+ / ⋮⋮）；紧凑布局可关闭。 */
  showSideMenu?: boolean;
  /**
   * 为 true 时强制隐藏格式化工具栏（仅在空白区域 mousedown 期间短暂置 true 用于消闪，
   * 由 Editor.tsx 的空白点击处理器管理）。
   */
  suppressFormattingToolbar?: boolean;
  usesRawEditorContent: boolean;
};

export function EditorComposer({
  editor,
  editable,
  page,
  editorContainerRef,
  handleEditorBlankMouseDown,
  handleEditorPasteCapture,
  getSlashItems,
  pageIdForUpdateRef,
  syncedContentSignatureRef,
  debouncedUpdate,
  userInteractedRef,
  silentContentSync,
  isEditorFullWidth,
  effectiveTheme,
  tableEvenColumnWidth,
  searchProviders,
  customActions,
  showSideMenu = true,
  suppressFormattingToolbar = false,
  usesRawEditorContent,
}: EditorComposerProps) {
  const singleTabMode = useSettings((state) => state.singleTabMode);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkPopoverUrl, setLinkPopoverUrl] = useState("");
  const linkPopoverRef = useRef<HTMLDivElement | null>(null);
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findNavigationRequest, setFindNavigationRequest] = useState<{
    id: number;
    direction: "next" | "previous";
  } | null>(null);
  const findNavigationRequestIdRef = useRef(0);
  const { ai: aiSettings } = useEditorSettings();
  const { onPromotePreview } = useEditorPageContext();

  const handleEditorKeyDownCapture = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (
      (!__GOOSE_EDITOR_AI__ && __HOST_TARGET__ !== "native-editor") ||
      event.key !== " " ||
      event.defaultPrevented ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      !editable ||
      !aiSettings.enabled ||
      (page?.localFilePath && __HOST_TARGET__ !== "native-editor")
    ) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!target?.closest(".bn-editor")) return;

    let block: any;
    try {
      block = editor.getTextCursorPosition().block;
    } catch {
      return;
    }
    const content = block?.content;
    const isEmptyParagraph =
      block?.type === "paragraph" &&
      (content === "" ||
        content == null ||
        (Array.isArray(content) && content.length === 0));
    if (!isEmptyParagraph) return;

    event.preventDefault();
    event.stopPropagation();
    if (__HOST_TARGET__ === "native-editor") {
      window.dispatchEvent(new CustomEvent("goose-note:native-ai-entry", {
        detail: { source: "empty-paragraph" },
      }));
      return;
    }
    const ai = editor.getExtension(AIExtension);
    if (ai && block.id) {
      ai.openAIMenuAtBlock(block.id);
    }
  };

  useEffect(() => {
    const handleOpenFind = () => {
      // 先关其它弹层，再开查找栏。setTimeout 让 Escape 引发的 commit 先跑完，
      // 避免被同步的 close 路径反吃掉。
      closeAllOverlays();
      setTimeout(() => setFindBarOpen(true), 0);
    };
    window.addEventListener("goose-note:editor-find-open", handleOpenFind);
    return () =>
      window.removeEventListener("goose-note:editor-find-open", handleOpenFind);
  }, []);

  useEffect(() => {
    // 原生 AppKit 菜单通过桥接事件驱动查找导航。uTools 有自己的热键链路，
    // 不在共享编辑器里接管，避免原生宿主接线改变其它宿主的运行时行为。
    if (__HOST_TARGET__ !== "native-editor") return;

    const handleFindNavigation = (event: Event) => {
      const direction = (event as CustomEvent<{ direction?: unknown }>).detail
        ?.direction;
      if (direction !== "next" && direction !== "previous") return;
      setFindBarOpen(true);
      findNavigationRequestIdRef.current += 1;
      setFindNavigationRequest({
        id: findNavigationRequestIdRef.current,
        direction,
      });
    };
    window.addEventListener("goose-note:editor-find-nav", handleFindNavigation);
    return () =>
      window.removeEventListener(
        "goose-note:editor-find-nav",
        handleFindNavigation,
      );
  }, []);

  useEffect(() => {
    const handleOpen = () => {
      setLinkPopoverUrl("");
      setLinkPopoverOpen(true);
    };
    const handleClose = () => setLinkPopoverOpen(false);
    document.addEventListener("goose-open-link-popover", handleOpen);
    document.addEventListener("goose-close-link-popover", handleClose);
    return () => {
      document.removeEventListener("goose-open-link-popover", handleOpen);
      document.removeEventListener("goose-close-link-popover", handleClose);
    };
  }, []);

  useEffect(() => {
    if (!linkPopoverOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (linkPopoverRef.current?.contains(target)) return;
      setLinkPopoverOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLinkPopoverOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleEscape, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, [linkPopoverOpen]);

  const handleLinkPopoverSubmit = () => {
    const trimmed = linkPopoverUrl.trim();
    if (trimmed) {
      editor.createLink(trimmed);
    }
    setLinkPopoverOpen(false);
    setLinkPopoverUrl("");
  };

  const formattingToolbarStoreOpen = useExtensionState(
    FormattingToolbarExtension,
    { editor },
  );
  const formattingToolbarSelectionAllowed = useEditorState({
    editor,
    on: "selection",
    selector: ({ editor }) => shouldRenderFormattingToolbar(editor),
  });
  const formattingToolbarAiActive = useFormattingToolbarAi((s) => s.active);
  const formattingToolbarOpen =
    !suppressFormattingToolbar &&
    (formattingToolbarAiActive ||
      (formattingToolbarStoreOpen && formattingToolbarSelectionAllowed));

  const formattingToolbarFloatingOptions = useMemo(
    () => ({
      useFloatingOptions: {
        open: formattingToolbarOpen,
        // 默认落在完整选区下方，避免覆盖被选文字或越过正文顶边压到页头。
        // 底部空间不足时再翻到上方；shift 同时兜住窄窗口与多标签布局的横向边界。
        placement: "bottom-start" as const,
        middleware: [
          floatingOffset(10),
          floatingFlip({
            fallbackPlacements: ["top-start"],
            padding: 8,
          }),
          floatingShift({ padding: 8 }),
        ],
      },
    }),
    [formattingToolbarOpen],
  );

  const slashMenuFloatingOptions = useMemo(
    () =>
      __GOOSE_EDITOR_COMPACT__
        ? getCompactSlashMenuFloatingOptions()
        : undefined,
    [],
  );
  const handleLocalFileTitleEnter = useCallback(() => {
    const firstBlock = editor.document[0];
    if (!firstBlock) return;

    const [inserted] = editor.insertBlocks(
      [{ type: "paragraph", content: "" }],
      firstBlock,
      "before",
    );
    if (inserted) {
      editor.setTextCursorPosition(inserted, "start");
      editor.focus();
    }
  }, [editor]);

  return (
    <EditorContextMenu
      editor={editor}
      editable={editable}
      page={page}
      editorContainerRef={editorContainerRef}
      handleEditorBlankMouseDown={handleEditorBlankMouseDown}
      handleEditorPasteCapture={handleEditorPasteCapture}
      handleEditorKeyDownCapture={handleEditorKeyDownCapture}
      searchProviders={searchProviders}
      customActions={customActions}
      effectiveTheme={effectiveTheme}
      isEditorFullWidth={isEditorFullWidth}
      tableEvenColumnWidth={tableEvenColumnWidth}
    >
      {page?.localFilePath && !singleTabMode && (
        <LocalFileTitle
          pageId={page.id}
          localFilePath={page.localFilePath}
          onEnterBelow={handleLocalFileTitleEnter}
        />
      )}
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme={effectiveTheme}
        slashMenu={false}
        formattingToolbar={false}
        linkToolbar={false}
        sideMenu={false}
        tableHandles={false}
        filePanel={false}
        onChange={() => {
          const safePageId = pageIdForUpdateRef.current;
          if (!safePageId) return;
          // raw 文档跳过 normalizePageContent（含 ensureFirstTitleHeading），
          // 与 Editor.tsx 切页/commit 路径保持一致，避免程序化规范化误触保存。
          // 用户真实输入仍会让文档签名偏离基线，照常走 debouncedUpdate 保存。
          // 须与 Editor.tsx 的 contentMode 保持一致；raw 文档不执行页面级规范化。
          const usesRawContent = usesRawEditorContent;
          // 用户意图门控（仅 raw 文档）：打开后无任何用户交互时的 onChange 来自
          // BlockNote 异步 props 补全（折叠块/视频/带属性图片等），静默同步 store 与
          // 基线、不入保存队列。一旦用户交互过（打字/IME/点击/拖拽…），照常入队保存。
          if (usesRawContent && !userInteractedRef.current) {
            const nextContent = clonePageContent(
              editor.document as BlockNoteContent,
            );
            const nextSig = getContentSignature(nextContent);
            if (nextSig === syncedContentSignatureRef.current) return;
            syncedContentSignatureRef.current = nextSig;
            silentContentSync(nextContent);
            return;
          }
          debouncedUpdate(safePageId);
          if (userInteractedRef.current) {
            onPromotePreview?.();
          }
        }}
      >
        {showSideMenu ? <EditorSideMenu /> : null}
        <TableHandlesController
          tableHandle={GooseTableHandle}
          extendButton={GooseTableExtendButton}
        />
        {__GOOSE_EDITOR_COMPACT__ ? (
          <FixedFormattingToolbarController
            formattingToolbar={EditorFormattingToolbar}
            open={formattingToolbarOpen}
          />
        ) : (
          <FormattingToolbarController
            formattingToolbar={EditorFormattingToolbar}
            floatingUIOptions={formattingToolbarFloatingOptions}
          />
        )}
        <LinkToolbarController linkToolbar={EditorLinkToolbar} />
        <FilePanelController filePanel={EditorFilePanel} />
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={getSlashItems}
          floatingUIOptions={slashMenuFloatingOptions}
          shouldOpen={(event) =>
            shouldOpenSlashSuggestionMenu(event, editor, {
              allowSlashMenuOnFirstBlock: usesRawEditorContent,
            })
          }
          suggestionMenuComponent={CustomSlashMenu as any}
          onItemClick={(item) => {
            if (item && "onItemClick" in item) {
              (item as any).onItemClick();
            }
          }}
        />
        <SuggestionMenuController
          triggerCharacter="、"
          getItems={getSlashItems}
          floatingUIOptions={slashMenuFloatingOptions}
          shouldOpen={(event) =>
            shouldOpenSlashSuggestionMenu(event, editor, {
              allowSlashMenuOnFirstBlock: usesRawEditorContent,
            })
          }
          suggestionMenuComponent={CustomSlashMenu as any}
          onItemClick={(item) => {
            if (item && "onItemClick" in item) {
              (item as any).onItemClick();
            }
          }}
        />
        {/* 紧凑编辑器构建不挂 AI 菜单。 */}
        {__GOOSE_EDITOR_AI__ && aiSettings.enabled && (
          <AIMenuController aiMenu={GooseAIMenu} />
        )}
      </BlockNoteView>
      {linkPopoverOpen && (
        <div
          ref={linkPopoverRef}
          className="absolute z-[20020] flex items-center gap-1.5 rounded-lg border border-border/80 bg-popover p-2 shadow-[0_8px_22px_rgba(15,23,42,0.1),0_1px_3px_rgba(15,23,42,0.06)] dark:border-white/15 dark:bg-[#2f3437]"
          style={{ top: 8, left: "50%", transform: "translateX(-50%)" }}
        >
          <input
            value={linkPopoverUrl}
            onChange={(e) => setLinkPopoverUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleLinkPopoverSubmit();
              }
              if (e.key === "Escape") {
                setLinkPopoverOpen(false);
              }
            }}
            placeholder="https://..."
            autoFocus
            className="h-8 w-56 rounded-md border border-transparent bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          />
          <button
            type="button"
            onClick={handleLinkPopoverSubmit}
            className="flex h-8 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            确认
          </button>
        </div>
      )}
      <ImageLightbox editor={editor} editorContainerRef={editorContainerRef} />
      <FindInPageBar
        editor={editor}
        open={findBarOpen}
        navigationRequest={findNavigationRequest}
        onClose={() => setFindBarOpen(false)}
      />
    </EditorContextMenu>
  );
}
