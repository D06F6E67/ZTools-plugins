import { TooltipContent } from "@/components/editor/ui/tooltip";
import { Kbd } from "@/components/editor/ui/kbd";

export function ToolbarTooltip({
  label,
  shortcut,
}: {
  label: string;
  shortcut?: string;
}) {
  return (
    <TooltipContent side="top" sideOffset={8}>
      <div className="inline-flex items-center gap-2 leading-none whitespace-nowrap">
        <span className="text-[12px] font-medium text-foreground">{label}</span>
        {shortcut ? <Kbd shortcut={shortcut} /> : null}
      </div>
    </TooltipContent>
  );
}

export type BindTooltip = (id: string) => {
  delayDuration: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};
