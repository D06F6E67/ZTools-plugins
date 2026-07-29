import * as LucideIcons from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface IconSelectorProps<T extends HTMLElement = HTMLElement> {
  value?: string;
  onChange: (icon: string | undefined) => void;
  children: React.ReactNode;
  portalContainerRef?: React.RefObject<T | null>;
  onFirstOpen?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const CURATED_ICONS: string[] = [
  "BookOpen",
  "Book",
  "BookMarked",
  "Notebook",
  "NotebookPen",
  "GraduationCap",
  "FileText",
  "Clipboard",
  "ClipboardList",
  "Folder",
  "FolderOpen",
  "Archive",
  "Inbox",
  "Bookmark",
  "Tag",
  "Flag",
  "Target",
  "Lightbulb",
  "Sparkles",
  "Calendar",
  "Clock",
  "Star",
  "Heart",
  "Coffee",
  "Briefcase",
];



export function IconSelector<T extends HTMLElement = HTMLElement>({
  value,
  onChange,
  children,
  portalContainerRef,
  onFirstOpen,
  open: controlledOpen,
  onOpenChange,
}: IconSelectorProps<T>) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const portalContainer = portalContainerRef?.current ?? undefined;
  const hasOpenedRef = useRef(false);

  const filteredIcons = useMemo(
    () => CURATED_ICONS.filter((key) => key in (LucideIcons as any)),
    [],
  );

  useEffect(() => {
    if (open && !hasOpenedRef.current && onFirstOpen) {
      hasOpenedRef.current = true;
      onFirstOpen();
    }
  }, [open, onFirstOpen]);

  const handleRandomIcon = () => {
    if (filteredIcons.length === 0) return;
    onChange(filteredIcons[Math.floor(Math.random() * filteredIcons.length)]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {isControlled ? (
        <PopoverAnchor asChild>{children}</PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      )}
      <PopoverContent
        className="w-[300px] p-0 rounded-[14px] shadow-[0_16px_36px_rgba(15,23,42,0.12),0_2px_8px_rgba(15,23,42,0.06)] overflow-hidden bg-popover text-foreground border border-border/40"
        align="start"
        side="bottom"
        collisionPadding={10}
        container={portalContainer}
      >
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <div className="text-[12px] font-medium text-muted-foreground">
            选择图标
          </div>
          <div className="flex items-center gap-1">
            <TooltipProvider delayDuration={600}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-muted-foreground/80 transition-colors hover:bg-[var(--goose-interactive-hover)] hover:text-foreground"
                    aria-label="随机"
                    onClick={handleRandomIcon}
                  >
                    <LucideIcons.Shuffle className="h-3.5 w-3.5 stroke-[1.6]" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">随机</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <button
              type="button"
              className="inline-flex h-7 items-center justify-center rounded-[8px] px-2 text-[11.5px] text-muted-foreground/80 transition-colors hover:bg-[var(--goose-interactive-hover)] hover:text-foreground"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              移除
            </button>
          </div>
        </div>

        <ScrollArea className="bg-popover">
          <div className="px-3 pb-3 grid grid-cols-6 gap-1">
            {filteredIcons.map((iconName) => {
              const Icon = (LucideIcons as any)[iconName];
              const selected = value === iconName;
              return (
                <button
                  key={iconName}
                  type="button"
                  className={cn(
                    "group/icon inline-flex aspect-square w-full items-center justify-center rounded-[10px] transition-all duration-150",
                    selected
                      ? "bg-[var(--goose-interactive-selected)] text-foreground"
                      : "text-muted-foreground/85 hover:bg-[var(--goose-interactive-hover)] hover:text-foreground",
                  )}
                  onClick={() => {
                    onChange(iconName);
                    setOpen(false);
                  }}
                  aria-label={iconName}
                  aria-pressed={selected}
                >
                  <Icon
                    className={cn(
                      "h-[18px] w-[18px] stroke-[1.6] transition-transform duration-150",
                      selected ? "scale-[1.05]" : "group-hover/icon:scale-[1.04]",
                    )}
                  />
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
