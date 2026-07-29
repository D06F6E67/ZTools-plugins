import * as LucideIcons from "lucide-react";
import { Tooltip, TooltipTrigger } from "@/components/editor/ui/tooltip";
import { Toggle } from "@/components/editor/ui/toggle";
import { Separator } from "@/components/editor/ui/separator";
import { useBlockNoteEditor } from "@blocknote/react";
import { ToolbarTooltip, type BindTooltip } from "../ToolbarTooltip";

const ITEM_CLASS =
  "h-7 min-w-7 rounded-md px-0 text-foreground/90 hover:bg-muted data-[state=on]:bg-accent data-[state=on]:text-foreground";

export function InlineGroup({
  isUnderline,
  isCode,
  bindTooltip,
  hideMarks,
}: {
  isUnderline: boolean;
  isCode: boolean;
  bindTooltip: BindTooltip;
  hideMarks?: boolean;
}) {
  const editor = useBlockNoteEditor();

  if (hideMarks) return null;

  return (
    <>
      <Tooltip {...bindTooltip("underline")}>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={isUnderline}
            onPressedChange={() => editor.toggleStyles({ underline: true })}
            aria-label="下划线"
            className={ITEM_CLASS}
          >
            <LucideIcons.Underline className="h-[15px] w-[15px]" />
          </Toggle>
        </TooltipTrigger>
        <ToolbarTooltip label="下划线" shortcut="Mod+U" />
      </Tooltip>

      <Separator orientation="vertical" className="h-5 opacity-70" />

      <Tooltip {...bindTooltip("code")}>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={isCode}
            onPressedChange={() => editor.toggleStyles({ code: true })}
            aria-label="行内代码"
            className={ITEM_CLASS}
          >
            <LucideIcons.Code className="h-[15px] w-[15px]" />
          </Toggle>
        </TooltipTrigger>
        <ToolbarTooltip label="行内代码" shortcut="Mod+E" />
      </Tooltip>
    </>
  );
}
