import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import {
  type AiComposerPayload,
  type AiComposerToken,
  type AiFileReferenceAttrs,
  type AiReferenceSuggestionItem,
} from "./referenceLookup";
import { ComposerSuggestionsList } from "@/components/editor/ai/composer/ComposerSuggestionsList";
import {
  createChipElement,
  useReferenceMentions,
} from "./useReferenceMentions";
import { useEditorPageContext } from "@/components/editor/platform/hostContext";
import type { JSONContent } from "@/types";

// ─── DOM helpers ────────────────────────────────────────────────────────────

function readTokensFromDom(container: HTMLElement): AiComposerToken[] {
  const tokens: AiComposerToken[] = [];

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) tokens.push({ type: "text", text });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === "BR") {
        tokens.push({ type: "text", text: "\n" });
      } else if (el.dataset.aiMentionAttrs) {
        try {
          const attrs = JSON.parse(
            el.dataset.aiMentionAttrs,
          ) as AiFileReferenceAttrs;
          tokens.push({ type: "reference", reference: attrs });
        } catch {
          // ignore malformed chip
        }
      } else {
        el.childNodes.forEach(walk);
      }
    }
  }

  container.childNodes.forEach(walk);
  return tokens;
}

function buildPayloadFromTokens(tokens: AiComposerToken[]): AiComposerPayload {
  const references: AiFileReferenceAttrs[] = [];
  let promptText = "";
  let freeformText = "";

  for (const token of tokens) {
    if (token.type === "text") {
      promptText += token.text;
      freeformText += token.text;
    } else {
      references.push(token.reference);
      promptText += `@${token.reference.titleSnapshot}`;
    }
  }

  return {
    promptText: promptText.trim(),
    freeformText: freeformText.trim(),
    references,
    tokens,
  };
}

function buildJsonContentFromTokens(
  tokens: AiComposerToken[],
): JSONContent | null {
  if (!tokens.length) return null;

  const paragraphs: AiComposerToken[][] = [[]];

  for (const token of tokens) {
    if (token.type === "text") {
      const parts = token.text.split("\n");
      if (parts[0])
        paragraphs[paragraphs.length - 1].push({
          type: "text",
          text: parts[0],
        });
      for (let i = 1; i < parts.length; i++) {
        paragraphs.push([]);
        if (parts[i])
          paragraphs[paragraphs.length - 1].push({
            type: "text",
            text: parts[i],
          });
      }
    } else {
      paragraphs[paragraphs.length - 1].push(token);
    }
  }

  if (!paragraphs.some((p) => p.length > 0)) return null;

  return {
    type: "doc",
    content: paragraphs.map((line) => ({
      type: "paragraph",
      content: line.map((token) =>
        token.type === "text"
          ? { type: "text", text: token.text }
          : { type: "aiFileReference", attrs: token.reference },
      ),
    })),
  };
}

function setDomFromJsonContent(
  container: HTMLElement,
  content: JSONContent | null | undefined,
) {
  container.innerHTML = "";
  if (!content?.content?.length) return;

  content.content.forEach((block: any, blockIdx: number) => {
    if (blockIdx > 0) container.appendChild(document.createElement("br"));
    (block.content ?? []).forEach((node: any) => {
      if (node.type === "text") {
        container.appendChild(document.createTextNode(node.text ?? ""));
      } else if (node.type === "aiFileReference" && node.attrs) {
        container.appendChild(
          createChipElement(node.attrs as AiFileReferenceAttrs),
        );
      }
    });
  });
}

/**
 * Insert a soft line break into the contenteditable composer.
 * Prefer native insertLineBreak / insertText; fall back to a trailing-safe <br>.
 * A lone trailing <br> often fails to create a visible new line in Chromium.
 */
function insertComposerLineBreak(editor: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection) return false;

  const selectionInsideEditor =
    selection.rangeCount > 0 &&
    (editor === selection.anchorNode ||
      editor.contains(selection.anchorNode));

  if (!selectionInsideEditor) {
    editor.focus();
    const endRange = document.createRange();
    endRange.selectNodeContents(editor);
    endRange.collapse(false);
    selection.removeAllRanges();
    selection.addRange(endRange);
  }

  try {
    if (document.execCommand("insertLineBreak")) return true;
  } catch {
    // fall through
  }

  // whitespace-pre-wrap makes a real newline text node render correctly
  try {
    if (document.execCommand("insertText", false, "\n")) return true;
  } catch {
    // fall through
  }

  if (!selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (
    editor !== range.commonAncestorContainer &&
    !editor.contains(range.commonAncestorContainer)
  ) {
    return false;
  }

  range.deleteContents();
  const br = document.createElement("br");
  range.insertNode(br);

  // Trailing <br> needs a following anchor node so the caret can sit on the new line
  if (!br.nextSibling) {
    const anchor = document.createElement("br");
    br.parentNode?.insertBefore(anchor, br.nextSibling);
  }

  const nextRange = document.createRange();
  nextRange.setStartAfter(br);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  return true;
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface AiComposerInputHandle {
  focus: () => void;
  clear: () => void;
  getPayload: () => AiComposerPayload;
}

interface AiComposerInputProps {
  placeholder: string;
  placeholderOverlayText?: string;
  autoFocusToken: number;
  onSubmit: () => void;
  onEscape: () => void;
  initialContent?: JSONContent | null;
  onContentChange?: (content: JSONContent | null) => void;
  onIsEmptyChange?: (isEmpty: boolean) => void;
  onReferenceAdded?: (reference: AiFileReferenceAttrs) => void;
  searchPages?: (query: string) => AiReferenceSuggestionItem[];
  referencePlacement?: "inline" | "external";
  variant?: "compact" | "panel";
  compactWidthClass?: string;
  disabled?: boolean;
}

export const AiComposerInput = forwardRef<
  AiComposerInputHandle,
  AiComposerInputProps
>(
  (
    {
      placeholder,
      placeholderOverlayText,
      autoFocusToken,
      onSubmit,
      onEscape,
      initialContent,
      onContentChange,
      onIsEmptyChange,
      onReferenceAdded,
      searchPages,
      referencePlacement = "inline",
      variant = "compact",
      compactWidthClass,
      disabled,
    },
    ref,
  ) => {
    const { onOpenPage } = useEditorPageContext();
    const editorRef = useRef<HTMLDivElement | null>(null);
    const isComposingRef = useRef(false);
    // Track the most recent content we emitted upward so we can ignore the echo
    // back via `initialContent` — otherwise the sync useEffect rebuilds the DOM
    // on every keystroke, invalidating the live selection and any cached ranges.
    const lastEmittedContentRef = useRef<JSONContent | null | undefined>(
      initialContent,
    );

    const [isEmpty, setIsEmpty] = useState(true);

    const emitCurrentContent = useCallback(() => {
      const el = editorRef.current;
      if (!el) return;

      const tokens = readTokensFromDom(el);
      const payload = buildPayloadFromTokens(tokens);
      const empty = payload.promptText.length === 0;
      setIsEmpty(empty);
      onIsEmptyChange?.(empty);
      const nextContent = buildJsonContentFromTokens(tokens);
      lastEmittedContentRef.current = nextContent;
      onContentChange?.(nextContent);
    }, [onIsEmptyChange, onContentChange]);

    const {
      mention,
      mentionItems,
      detectMention,
      insertMention,
      handleMentionKeyDown,
      handleMentionBlur,
      cancelMentionBlurTimer,
      clearMentionState,
    } = useReferenceMentions({
      editorRef,
      isComposingRef,
      onContentMutation: emitCurrentContent,
      onReferenceAdded,
      searchPages,
      referencePlacement,
    });

    // ── imperative handle ────────────────────────────────────────────────────

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          const el = editorRef.current;
          if (!el) return;
          el.focus();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
        },
        clear: () => {
          const el = editorRef.current;
          if (!el) return;
          el.innerHTML = "";
          lastEmittedContentRef.current = null;
          setIsEmpty(true);
          clearMentionState();
          onIsEmptyChange?.(true);
          onContentChange?.(null);
        },
        getPayload: (): AiComposerPayload => {
          const el = editorRef.current;
          if (!el)
            return {
              promptText: "",
              freeformText: "",
              references: [],
              tokens: [],
            };
          return buildPayloadFromTokens(readTokensFromDom(el));
        },
      }),
      [clearMentionState, onIsEmptyChange, onContentChange],
    );

    // ── sync initialContent → DOM ────────────────────────────────────────────

    useEffect(() => {
      // Skip the echo of our own emission — the DOM is already up to date and
      // rebuilding it would wipe the live text node our cached range points at.
      if (initialContent === lastEmittedContentRef.current) return;
      lastEmittedContentRef.current = initialContent;
      const el = editorRef.current;
      if (!el) return;
      setDomFromJsonContent(el, initialContent);
      const tokens = readTokensFromDom(el);
      const empty = buildPayloadFromTokens(tokens).promptText.length === 0;
      setIsEmpty(empty);
      onIsEmptyChange?.(empty);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialContent]);

    // ── auto-focus ───────────────────────────────────────────────────────────

    useEffect(() => {
      if (autoFocusToken > 0) editorRef.current?.focus();
    }, [autoFocusToken]);

    // ── input handler ────────────────────────────────────────────────────────

    const handleInput = useCallback(() => {
      emitCurrentContent();
      detectMention();
    }, [emitCurrentContent, detectMention]);

    // ── keyboard handler ─────────────────────────────────────────────────────

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.nativeEvent.isComposing || isComposingRef.current) return;

        if (handleMentionKeyDown(event)) return;

        if (event.key === "Escape") {
          event.preventDefault();
          onEscape();
          return;
        }

        if (event.key !== "Enter") return;

        // Shift+Enter：软换行（多行输入）
        if (event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          const el = editorRef.current;
          if (!el) return;
          if (insertComposerLineBreak(el)) {
            handleInput();
          }
          return;
        }

        // Enter / ⌘·Ctrl+Enter：发送
        event.preventDefault();
        onSubmit();
      },
      [handleMentionKeyDown, onSubmit, onEscape, handleInput],
    );

    // ── chip click delegation ────────────────────────────────────────────────

    const handleClick = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        const mentionId = target.dataset.aiMentionId;
        if (mentionId) {
          e.preventDefault();
          onOpenPage(mentionId);
        }
      },
      [onOpenPage],
    );

    return (
      <div
        className={cn(
          "relative min-w-0 flex-1",
          variant === "panel" ? "w-full px-0" : compactWidthClass,
        )}
      >
        {(placeholderOverlayText || placeholder) && isEmpty ? (
          <div
            className={cn(
              "pointer-events-none absolute left-0 right-0 z-[1] text-muted-foreground opacity-70",
              variant === "panel"
                ? "top-0 line-clamp-3 text-[13px] leading-6"
                : "top-0 pr-8 text-[12px] leading-[20px]",
            )}
          >
            {placeholderOverlayText ?? placeholder}
          </div>
        ) : null}

        <div
          ref={editorRef}
          role="textbox"
          aria-label="AI 输入"
          aria-multiline="true"
          aria-disabled={disabled ? "true" : undefined}
          contentEditable={!disabled}
          suppressContentEditableWarning
          data-ai-composer-editor="true"
          data-ai-composer-variant={variant}
          className={cn(
            "block w-full bg-transparent p-0 text-foreground outline-none",
            "overflow-y-auto break-words whitespace-pre-wrap",
            disabled && "cursor-not-allowed opacity-60",
            variant === "panel"
              ? "min-h-[24px] max-h-[144px] text-[13px] leading-6"
              : "min-h-[20px] max-h-[88px] text-[12px] leading-[20px]",
          )}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onClick={handleClick}
          onBlur={handleMentionBlur}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
            handleInput();
          }}
        />

        {mention.active && mention.anchorRect ? (
          <ComposerSuggestionsList
            items={mentionItems}
            activeIndex={mention.activeIndex}
            anchorRect={mention.anchorRect}
            onSelect={insertMention}
            onMouseDownCapture={cancelMentionBlurTimer}
          />
        ) : null}
      </div>
    );
  },
);

AiComposerInput.displayName = "AiComposerInput";
