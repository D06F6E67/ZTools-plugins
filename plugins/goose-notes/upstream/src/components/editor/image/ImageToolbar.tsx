import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Copy,
  Download,
  Maximize2,
} from "lucide-react";
import type { MouseEventHandler, ReactNode } from "react";
import { cn } from "@/components/editor/utils/cn";
import type { ImageAlignment } from "@/components/editor/image/imageUtils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/editor/ui/tooltip";

export interface SelectedImageState {
  blockId: string | null;
  src: string;
  alt?: string;
  index: number;
  rect: DOMRect;
  alignment: ImageAlignment;
}

interface ImageToolbarProps {
  selectedImage: SelectedImageState;
  applyImageAlignment: (alignment: ImageAlignment) => void;
  handleSelectedImageZoom: () => void;
  handleSelectedImageCopy: () => void;
  handleSelectedImageDownload: () => void;
}

const imageToolButtonClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground/90 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none";

function ImageToolButton({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className?: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn(imageToolButtonClass, className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function ImageToolbar({
  selectedImage,
  applyImageAlignment,
  handleSelectedImageZoom,
  handleSelectedImageCopy,
  handleSelectedImageDownload,
}: ImageToolbarProps) {
  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={100}>
      <div
        data-goose-image-toolbar
        className="fixed z-[20000] flex items-center gap-0.5 rounded-[10px] border border-border/75 bg-popover p-1 shadow-[0_8px_22px_rgba(15,23,42,0.1),0_1px_3px_rgba(15,23,42,0.06)] animate-in fade-in-0 zoom-in-95 duration-150 dark:border-white/15 dark:bg-[#2f3437]"
        style={{
          top: Math.max(8, selectedImage.rect.top - 42),
          left: selectedImage.rect.left + selectedImage.rect.width / 2,
          transform: "translateX(-50%)",
        }}
        onMouseDown={(e) => e.preventDefault()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        role="toolbar"
        aria-label="图片操作"
      >
        {(
          [
            ["left", "左对齐", AlignLeft],
            ["center", "居中对齐", AlignCenter],
            ["right", "右对齐", AlignRight],
          ] as const
        ).map(([alignment, label, Icon]) => (
          <ImageToolButton
            key={alignment}
            label={label}
            onClick={() => applyImageAlignment(alignment)}
            className={
              selectedImage.alignment === alignment
                ? "bg-accent text-foreground"
                : undefined
            }
          >
            <Icon className="h-[15px] w-[15px]" />
          </ImageToolButton>
        ))}

        <div className="mx-0.5 h-5 w-px bg-border/70" />

        <ImageToolButton label="放大图片" onClick={handleSelectedImageZoom}>
          <Maximize2 className="h-[15px] w-[15px]" />
        </ImageToolButton>
        <ImageToolButton label="复制图片" onClick={handleSelectedImageCopy}>
          <Copy className="h-[15px] w-[15px]" />
        </ImageToolButton>
        <ImageToolButton label="下载图片" onClick={handleSelectedImageDownload}>
          <Download className="h-[15px] w-[15px]" />
        </ImageToolButton>
      </div>
    </TooltipProvider>
  );
}
