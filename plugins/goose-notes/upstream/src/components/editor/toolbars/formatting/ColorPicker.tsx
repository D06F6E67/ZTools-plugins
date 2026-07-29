import { useBlockNoteEditor, useEditorState } from "@blocknote/react";
import { useEffect, useRef, useState } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import * as LucideIcons from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/editor/ui/tooltip";
import { Button } from "@/components/editor/ui/button";
import { Portal } from "@/components/editor/ui/portal";
import { cn } from "@/components/editor/utils/cn";

interface PositionState {
  top: number;
  left: number;
  showAbove: boolean;
}

/** BlockNote 命名颜色 —— 必须与 BlockNote CSS 中定义的颜色名一致 */
const TEXT_COLORS = [
  { name: "默认", color: "default" },
  { name: "灰色", color: "gray" },
  { name: "褐色", color: "brown" },
  { name: "红色", color: "red" },
  { name: "橙色", color: "orange" },
  { name: "黄色", color: "yellow" },
  { name: "绿色", color: "green" },
  { name: "蓝色", color: "blue" },
  { name: "紫色", color: "purple" },
  { name: "粉色", color: "pink" },
];

const HIGHLIGHT_COLORS = [
  { name: "无背景", color: "default" },
  { name: "灰色背景", color: "gray" },
  { name: "褐色背景", color: "brown" },
  { name: "红色背景", color: "red" },
  { name: "橙色背景", color: "orange" },
  { name: "黄色背景", color: "yellow" },
  { name: "绿色背景", color: "green" },
  { name: "蓝色背景", color: "blue" },
  { name: "紫色背景", color: "purple" },
  { name: "粉色背景", color: "pink" },
];

/** 颜色名 → CSS 颜色值（用于预览，与 BlockNote COLORS_DEFAULT 保持一致） */
const COLOR_PREVIEW: Record<string, string> = {
  gray: "#9b9a97",
  brown: "#64473a",
  red: "#e03e3e",
  orange: "#d9730d",
  yellow: "#dfab01",
  green: "#4d6461",
  blue: "#0b6e99",
  purple: "#6940a5",
  pink: "#ad1a72",
};

const BG_PREVIEW: Record<string, string> = {
  gray: "#ebeced",
  brown: "#e9e5e3",
  red: "#fbe4e4",
  orange: "#f6e9d9",
  yellow: "#fbf3db",
  green: "#ddedea",
  blue: "#ddebf1",
  purple: "#eae4f2",
  pink: "#f4dfeb",
};

const MIXED = "__mixed__";

/**
 * Walks the current selection and returns the textColor / backgroundColor
 * marks across it. Returns `MIXED` if the selection spans more than one value.
 * BlockNote's useActiveStyles() only reads marks at selection.$to, so it
 * can't detect heterogeneous color selections — we scan the range ourselves.
 */
function useSelectionColorState(editor: BlockNoteEditor<any, any, any>) {
  return useEditorState({
    editor,
    selector: ({ editor }) => {
      const { selection, doc } = editor.prosemirrorState;
      const textColors = new Set<string>();
      const bgColors = new Set<string>();
      const from = selection.from;
      const to = selection.to;

      if (from === to) {
        const marks = selection.$to.marks();
        const tc = marks.find((m: any) => m.type.name === "textColor");
        const bc = marks.find((m: any) => m.type.name === "backgroundColor");
        return {
          textColor: (tc?.attrs.stringValue as string | undefined) ?? "default",
          backgroundColor:
            (bc?.attrs.stringValue as string | undefined) ?? "default",
        };
      }

      doc.nodesBetween(from, to, (node: any) => {
        if (!node.isText) return true;
        const tc = node.marks.find((m: any) => m.type.name === "textColor");
        const bc = node.marks.find(
          (m: any) => m.type.name === "backgroundColor",
        );
        textColors.add(
          (tc?.attrs.stringValue as string | undefined) ?? "default",
        );
        bgColors.add(
          (bc?.attrs.stringValue as string | undefined) ?? "default",
        );
        return false;
      });

      return {
        textColor:
          textColors.size === 0
            ? "default"
            : textColors.size === 1
              ? [...textColors][0]
              : MIXED,
        backgroundColor:
          bgColors.size === 0
            ? "default"
            : bgColors.size === 1
              ? [...bgColors][0]
              : MIXED,
      };
    },
  });
}

export function FormattingToolbarColorPicker() {
  const editor = useBlockNoteEditor();
  const selectionColors = useSelectionColorState(editor);
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [position, setPosition] = useState<PositionState>({
    top: 0,
    left: 0,
    showAbove: true,
  });
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeAnimTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (closeAnimTimeoutRef.current)
        clearTimeout(closeAnimTimeoutRef.current);
    };
  }, []);

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    if (closeAnimTimeoutRef.current) clearTimeout(closeAnimTimeoutRef.current);

    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const panelHeight = 280;
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      const showAbove = spaceAbove >= panelHeight || spaceAbove > spaceBelow;

      setPosition({
        top: showAbove ? rect.top - 8 : rect.bottom + 8,
        left: rect.left + rect.width / 2,
        showAbove,
      });
    }

    setIsMounted(true);
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  useEffect(() => {
    if (isOpen) {
      setIsMounted(true);
      return;
    }
    if (closeAnimTimeoutRef.current) clearTimeout(closeAnimTimeoutRef.current);
    closeAnimTimeoutRef.current = setTimeout(() => {
      setIsMounted(false);
    }, 180);
  }, [isOpen]);

  const currentTextColor = selectionColors.textColor;
  const currentBgColor = selectionColors.backgroundColor;
  const isTextMixed = currentTextColor === MIXED;
  const isBgMixed = currentBgColor === MIXED;

  const isTextColorActive =
    !isTextMixed && currentTextColor && currentTextColor !== "default";
  const isBgColorActive =
    !isBgMixed && currentBgColor && currentBgColor !== "default";

  const previewTextColor = isTextMixed
    ? undefined
    : currentTextColor && currentTextColor !== "default"
      ? COLOR_PREVIEW[currentTextColor]
      : undefined;
  const previewBgColor = isBgMixed
    ? undefined
    : currentBgColor && currentBgColor !== "default"
      ? BG_PREVIEW[currentBgColor]
      : undefined;

  const mixedDotGradient =
    "conic-gradient(#e03e3e 0deg 90deg, #dfab01 90deg 180deg, #0b6e99 180deg 270deg, #6940a5 270deg 360deg)";
  const mixedBarGradient =
    "repeating-linear-gradient(45deg, hsl(var(--foreground) / 0.45) 0 2px, transparent 2px 4px)";

  const applyTextColor = (color: string) => {
    if (color === "default") {
      editor.removeStyles({ textColor: true } as any);
    } else {
      editor.addStyles({ textColor: color });
    }
  };

  const applyBackgroundColor = (color: string) => {
    if (color === "default") {
      editor.removeStyles({ backgroundColor: true } as any);
    } else {
      editor.addStyles({ backgroundColor: color });
    }
  };

  const applyColorPair = (index: number) => {
    const textColor = TEXT_COLORS[index]?.color;
    const backgroundColor = HIGHLIGHT_COLORS[index]?.color;
    if (!textColor || !backgroundColor) return;
    applyTextColor(textColor);
    applyBackgroundColor(backgroundColor);
  };

  const panelContent = isMounted ? (
    <div
      className={cn(
        "fixed z-[20000] w-fit rounded-[10px] border border-border/75 bg-popover p-1 shadow-[0_8px_22px_hsl(var(--foreground)/0.08),0_1px_3px_hsl(var(--foreground)/0.05)] backdrop-blur-[1px] transition-all duration-180 ease-out dark:border-white/20",
        isOpen
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none",
      )}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        top: position.top,
        left: position.left,
        transform: position.showAbove
          ? isOpen
            ? "translate(-50%, -100%)"
            : "translate(-50%, calc(-100% - 4px))"
          : isOpen
            ? "translate(-50%, 0)"
            : "translate(-50%, -4px)",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="flex flex-col gap-1">
        <div className="px-1 pt-0.5 text-[12px] font-semibold text-muted-foreground">
          文本颜色
        </div>
        <div className="grid grid-cols-[repeat(5,1.75rem)] gap-1 px-1">
          {TEXT_COLORS.map((item, index) => (
            <Button
              key={item.color}
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 rounded-[6px] border border-transparent p-0 hover:bg-accent hover:text-accent-foreground",
                isTextColorActive && currentTextColor === item.color
                  ? "bg-accent border-primary/20 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.03)]"
                  : "",
              )}
              onClick={() => {
                applyTextColor(item.color);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                applyColorPair(index);
              }}
            >
              <div
                className="font-serif text-[34px] leading-none scale-[0.56]"
                style={{
                  color:
                    item.color === "default"
                      ? undefined
                      : COLOR_PREVIEW[item.color],
                }}
              >
                A
              </div>
            </Button>
          ))}
        </div>

        <div className="my-1 border-t border-border/60" />

        <div className="px-1 text-[12px] font-semibold text-muted-foreground">
          背景颜色
        </div>
        <div className="grid grid-cols-[repeat(5,1.75rem)] gap-1 px-1 pb-0.5">
          {HIGHLIGHT_COLORS.map((item, index) => (
            <Button
              key={item.color}
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 rounded-[6px] border border-transparent p-0 hover:border-border/80 hover:bg-accent/40",
                isBgColorActive && currentBgColor === item.color
                  ? "border-primary ring-1 ring-primary/25"
                  : "",
              )}
              onClick={() => {
                applyBackgroundColor(item.color);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                applyColorPair(index);
              }}
            >
              <div
                className="h-5 w-5 rounded-[4px] border border-border/20"
                style={{
                  backgroundColor:
                    item.color === "default"
                      ? "transparent"
                      : BG_PREVIEW[item.color],
                }}
              />
            </Button>
          ))}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>
          <button
            type="button"
            ref={buttonRef}
            aria-pressed={
              isTextColorActive || isBgColorActive || isTextMixed || isBgMixed
            }
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md p-0 text-foreground/90 transition-colors hover:bg-muted",
              "aria-pressed:bg-accent aria-pressed:text-foreground",
            )}
            aria-label="颜色选择"
          >
            <span className="relative inline-flex h-[18px] w-[14px] items-center justify-center">
              {isTextMixed ? (
                <span
                  className="block h-[12px] w-[12px] rounded-full"
                  style={{ background: mixedDotGradient }}
                />
              ) : (
                <span
                  className="font-serif text-[15px] font-semibold leading-none"
                  style={{ color: previewTextColor }}
                >
                  A
                </span>
              )}
              <span
                className="absolute -bottom-[1px] left-1/2 h-[2.5px] w-3 -translate-x-1/2 rounded-full"
                style={{
                  background: isBgMixed
                    ? mixedBarGradient
                    : (previewBgColor ?? "transparent"),
                  border: isBgColorActive
                    ? "1px solid hsl(var(--foreground) / 0.08)"
                    : undefined,
                }}
              />
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          <div className="text-[12px] font-medium leading-none">
            {isTextMixed || isBgMixed ? "颜色（混合）" : "颜色"}
          </div>
        </TooltipContent>
      </Tooltip>
      <Portal>{panelContent}</Portal>
    </div>
  );
}
