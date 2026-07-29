import { useState, useCallback } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { defaultProps, type BlockNoteEditor } from "@blocknote/core";
import {
  Lightbulb,
  AlertTriangle,
  CircleAlert,
  CircleCheck,
  Flame,
  Pin,
  MessageSquare,
  Target,
  Rocket,
  Star,
  Bell,
  Bug,
  type LucideIcon,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/editor/ui/popover";
import { cn } from "@/components/editor/utils/cn";

const ICON_COMPONENTS: Record<string, LucideIcon> = {
  Lightbulb,
  AlertTriangle,
  CircleAlert,
  CircleCheck,
  Flame,
  Pin,
  MessageSquare,
  Target,
  Rocket,
  Star,
  Bell,
  Bug,
};

const ICON_LIST = Object.keys(ICON_COMPONENTS);

export const DEFAULT_CALLOUT_ICON = "Lightbulb";

/** Lucide 图标名 → 语义对应 emoji，供导出端使用 */
export const LUCIDE_ICON_TO_EMOJI: Record<string, string> = {
  Lightbulb: "💡",
  AlertTriangle: "⚠️",
  CircleAlert: "❗",
  CircleCheck: "✅",
  Flame: "🔥",
  Pin: "📌",
  MessageSquare: "💬",
  Target: "🎯",
  Rocket: "🚀",
  Star: "⭐",
  Bell: "🔔",
  Bug: "🐛",
};

/** 将 Lucide 名（新存）或 emoji（存量）统一渲染为 React 元素 */
function renderCalloutIcon(iconStr: string, className?: string) {
  const resolved = iconStr || DEFAULT_CALLOUT_ICON;
  const IconComp = ICON_COMPONENTS[resolved];
  if (IconComp) {
    return (
      <IconComp
        className={cn("h-[1em] w-[1em] stroke-[1.75]", className)}
      />
    );
  }
  return (
    <span className={cn("text-[1em] leading-none", className)}>
      {resolved}
    </span>
  );
}

function stopEditorMouseDown(e: React.MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

function CalloutIconPicker({
  icon,
  onPick,
}: {
  icon: string;
  onPick: (iconName: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div contentEditable={false}>
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="callout-icon-slot shrink-0 rounded transition-colors hover:bg-[var(--goose-interactive-hover)]"
            onMouseDown={stopEditorMouseDown}
            onClick={() => setOpen(true)}
            data-callout-icon-trigger
          >
            {renderCalloutIcon(icon)}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[220px] p-2"
          side="bottom"
          align="start"
          onMouseDown={stopEditorMouseDown}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="grid grid-cols-6 gap-0.5">
            {ICON_LIST.map((name) => (
              <button
                key={name}
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded text-base transition-colors hover:bg-[var(--goose-interactive-hover)]"
                onMouseDown={stopEditorMouseDown}
                onClick={() => {
                  setOpen(false);
                  requestAnimationFrame(() => onPick(name));
                }}
              >
                {renderCalloutIcon(name)}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function CalloutBlockView({
  block,
  contentRef,
  editor,
}: {
  block: any;
  contentRef: (node: HTMLElement | null) => void;
  editor: BlockNoteEditor<any, any, any>;
}) {
  const icon = (block.props.icon as string) || DEFAULT_CALLOUT_ICON;

  const handleIconPick = useCallback(
    (iconName: string) => {
      editor.updateBlock(block.id, {
        props: { icon: iconName },
      });
    },
    [editor, block.id],
  );

  return (
    <div
      className="callout-block group flex w-full items-start gap-3 rounded-lg border border-[var(--goose-callout-border)] bg-[var(--goose-callout-bg)] px-3 py-2 text-[length:var(--editor-module-sm-font-size)] leading-[1.5]"
      data-callout="true"
    >
      <CalloutIconPicker icon={icon} onPick={handleIconPick} />
      <div
        ref={contentRef}
        className="callout-content min-w-0 flex-1"
      />
    </div>
  );
}

export const calloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      ...defaultProps,
      icon: {
        default: DEFAULT_CALLOUT_ICON,
      },
    },
    content: "inline",
  },
  {
    render: (props) => (
      <CalloutBlockView
        block={props.block}
        contentRef={props.contentRef}
        editor={props.editor as BlockNoteEditor<any, any, any>}
      />
    ),
    toExternalHTML: ({ block, contentRef }) => {
      return (
        <div
          className="flex items-start gap-3 rounded-lg border border-[var(--goose-callout-border)] bg-[var(--goose-callout-bg)] px-3 py-2 text-[length:var(--editor-module-sm-font-size)] leading-[1.5]"
          data-callout="true"
        >
          <span className="callout-icon-slot shrink-0">
            {renderCalloutIcon(
              (block.props.icon as string) || DEFAULT_CALLOUT_ICON,
            )}
          </span>
          <div
            ref={contentRef}
            className="callout-content min-w-0 flex-1"
          />
        </div>
      );
    },
  },
)();
