/**
 * Notebook AI composer — V3-B：附件（页面引用 + 粘贴/上传图）收进 dock 顶部。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, ImagePlus, Send, Square, X } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import {
  AiComposerInput,
  type AiComposerInputHandle,
} from "@/components/editor/ai/composer/AiComposerInput";
import { useEditorPageContext } from "@/components/editor/platform/hostContext";
import type {
  AiComposerPayload,
  AiFileReferenceAttrs,
  AiReferenceSuggestionItem,
} from "@/components/editor/ai/composer/referenceLookup";
import {
  isImageUploadFile,
  resolveImageMimeForUpload,
} from "@/components/editor/utils/pasteClipboardImage";
import { ModelSelectorPopover } from "./ModelSelectorPopover";

const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export interface NotebookAiImageAttachment {
  file: File;
  previewUrl: string;
}

interface ComposerProps {
  onSend: (
    payload: AiComposerPayload,
    images: NotebookAiImageAttachment[],
  ) => boolean | void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  searchPages?: (query: string) => AiReferenceSuggestionItem[];
  onEscape?: () => void;
  initialReference?: AiFileReferenceAttrs | null;
  /** 全屏时输入区居中加宽 */
  layout?: "side-panel" | "fullscreen";
}

function ImageChipPreview({
  src,
  name,
  anchorRect,
}: {
  src: string;
  name: string;
  anchorRect: DOMRect;
}) {
  const maxWidth = 176;
  const left = Math.min(
    Math.max(8, anchorRect.left),
    window.innerWidth - maxWidth - 8,
  );
  // 默认在芯片上方；空间不够则贴在下方
  const placeAbove = anchorRect.top > 168;
  const top = placeAbove ? anchorRect.top - 8 : anchorRect.bottom + 8;

  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[30000] w-44 rounded-[10px] bg-popover p-1.5 text-popover-foreground shadow-[0_12px_32px_rgba(15,23,42,0.28)] dark:bg-[#2e2e2e]"
      style={{
        left,
        top,
        transform: placeAbove ? "translateY(-100%)" : undefined,
      }}
    >
      <img
        src={src}
        alt={name}
        className="h-[120px] w-full rounded-[6px] object-cover"
      />
      <div className="mt-1.5 truncate px-0.5 text-[11px] text-muted-foreground">
        {name}
      </div>
    </div>,
    document.body,
  );
}

export function Composer({
  onSend,
  onStop,
  isStreaming,
  disabled,
  placeholder = "向 AI 提问，输入 @ 引用当前笔记本页面…",
  searchPages,
  onEscape,
  initialReference,
  layout = "side-panel",
}: ComposerProps) {
  const isFullscreen = layout === "fullscreen";
  const inputRef = useRef<AiComposerInputHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<NotebookAiImageAttachment[]>([]);
  const { onOpenPage } = useEditorPageContext();
  const [isEmpty, setIsEmpty] = useState(true);
  const [autoFocusToken, setAutoFocusToken] = useState(0);
  const [references, setReferences] = useState<AiFileReferenceAttrs[]>(() =>
    initialReference ? [initialReference] : [],
  );
  const [images, setImages] = useState<NotebookAiImageAttachment[]>([]);
  const [hoveredImage, setHoveredImage] = useState<{
    src: string;
    name: string;
    rect: DOMRect;
  } | null>(null);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(
    () => () => {
      imagesRef.current.forEach((image) =>
        URL.revokeObjectURL(image.previewUrl),
      );
    },
    [],
  );

  const handleEscape = useCallback(() => {
    onEscape?.();
  }, [onEscape]);

  const handleSubmit = useCallback(() => {
    if (disabled || isStreaming || (isEmpty && images.length === 0)) return;
    const payload = inputRef.current?.getPayload();
    if (!payload || (!payload.promptText.trim() && images.length === 0)) return;

    const seenReferenceIds = new Set<string>();
    const mergedReferences = [...references, ...payload.references].filter(
      (reference) => {
        if (!reference.pageId || seenReferenceIds.has(reference.pageId)) {
          return false;
        }
        seenReferenceIds.add(reference.pageId);
        return true;
      },
    );
    const accepted = onSend(
      { ...payload, references: mergedReferences },
      images,
    );
    if (accepted === false) return;

    inputRef.current?.clear();
    setReferences([]);
    images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    setImages([]);
    setHoveredImage(null);
    setIsEmpty(true);
    setAutoFocusToken((token) => token + 1);
  }, [disabled, images, isStreaming, isEmpty, onSend, references]);

  const addReference = useCallback((reference: AiFileReferenceAttrs) => {
    setReferences((current) =>
      current.some((item) => item.pageId === reference.pageId)
        ? current
        : [...current, reference],
    );
  }, []);

  const removeReference = useCallback((pageId: string) => {
    setReferences((current) =>
      current.filter((reference) => reference.pageId !== pageId),
    );
  }, []);

  const addImageFiles = useCallback(
    (selectedFiles: File[]) => {
      if (selectedFiles.length === 0) return;

      const available = MAX_IMAGE_ATTACHMENTS - images.length;
      if (available <= 0) {
        toast.error(`每次最多添加 ${MAX_IMAGE_ATTACHMENTS} 张图片。`);
        return;
      }

      const accepted = selectedFiles
        .filter(isImageUploadFile)
        .filter((file) => {
          if (file.size <= MAX_IMAGE_FILE_BYTES) return true;
          toast.error(`“${file.name}”超过 10MB，未添加。`);
          return false;
        })
        .filter((file) =>
          SUPPORTED_IMAGE_MEDIA_TYPES.has(resolveImageMimeForUpload(file)),
        )
        .slice(0, available)
        .map((file) => {
          const mediaType = resolveImageMimeForUpload(file);
          const normalizedFile =
            file.type === mediaType
              ? file
              : new File([file], file.name, {
                  type: mediaType,
                  lastModified: file.lastModified,
                });
          return {
            file: normalizedFile,
            previewUrl: URL.createObjectURL(normalizedFile),
          };
        });

      if (accepted.length === 0) {
        toast.error("请选择 PNG、JPEG、WebP 或 GIF 图片。");
        return;
      }
      if (accepted.length < selectedFiles.length) {
        toast.message(`已添加 ${accepted.length} 张图片。`);
      }
      setImages((current) => [...current, ...accepted]);
    },
    [images.length],
  );

  const handleImageInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files ?? []);
      event.target.value = "";
      addImageFiles(selectedFiles);
    },
    [addImageFiles],
  );

  /** 粘贴图片 → 与上传同一套附件芯片 */
  const handleDockPaste = useCallback(
    (event: React.ClipboardEvent) => {
      if (disabled || isStreaming) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      const imageFiles = files.filter(isImageUploadFile);
      if (imageFiles.length === 0) return;
      event.preventDefault();
      addImageFiles(imageFiles);
    },
    [addImageFiles, disabled, isStreaming],
  );

  const removeImage = useCallback((previewUrl: string) => {
    setImages((current) => {
      const target = current.find((image) => image.previewUrl === previewUrl);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((image) => image.previewUrl !== previewUrl);
    });
    setHoveredImage(null);
  }, []);

  const canSend = !isStreaming && !disabled && (!isEmpty || images.length > 0);
  const hasAttachments = references.length > 0 || images.length > 0;

  return (
    <div
      className={cn(
        "shrink-0",
        isFullscreen ? "px-6 py-3" : "px-3 py-2.5",
      )}
    >
      <div
        className={cn(
          "mx-auto w-full",
          isFullscreen ? "max-w-[720px]" : "max-w-none",
        )}
      >
        {/* V3-B dock：附件条 + 输入 + 工具行 一体 */}
        <div
          className={cn(
            "flex flex-col rounded-[16px] bg-[var(--goose-interactive-hover)] px-3 py-2.5",
            "shadow-[0_8px_24px_rgba(15,23,42,0.08)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.22)]",
            "transition-colors duration-150",
          )}
          onPaste={handleDockPaste}
        >
          {hasAttachments ? (
            <div
              className="mb-2.5 flex w-full min-w-0 flex-wrap content-start items-start gap-1.5 border-b border-border/40 pb-2.5"
              aria-label="本轮附件"
            >
              {references.map((reference) => (
                <div
                  key={reference.pageId}
                  className="group relative inline-flex h-[30px] max-w-[min(180px,100%)] min-w-0 shrink-0 items-center gap-1.5 rounded-[8px] bg-black/10 py-0 pl-2 pr-1 dark:bg-black/25"
                >
                  <button
                    type="button"
                    onClick={() => onOpenPage(reference.pageId)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 outline-none"
                    aria-label={`打开页面：${reference.titleSnapshot}`}
                    title={`打开“${reference.titleSnapshot}”`}
                  >
                    <FileText
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={1.75}
                    />
                    <span className="min-w-0 truncate text-xs text-foreground">
                      {reference.titleSnapshot}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeReference(reference.pageId)}
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-background/60 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                    aria-label={`移除页面上下文：${reference.titleSnapshot}`}
                    title={`移除“${reference.titleSnapshot}”`}
                  >
                    <X className="h-3 w-3" strokeWidth={1.9} />
                  </button>
                </div>
              ))}

              {images.map((image) => (
                <div
                  key={image.previewUrl}
                  className="group relative inline-flex h-[30px] max-w-[min(180px,100%)] min-w-0 shrink-0 items-center gap-1.5 rounded-[8px] bg-black/10 py-0 pl-1.5 pr-1 dark:bg-black/25"
                  onMouseEnter={(event) => {
                    setHoveredImage({
                      src: image.previewUrl,
                      name: image.file.name,
                      rect: event.currentTarget.getBoundingClientRect(),
                    });
                  }}
                  onMouseLeave={() => setHoveredImage(null)}
                  onFocus={(event) => {
                    setHoveredImage({
                      src: image.previewUrl,
                      name: image.file.name,
                      rect: event.currentTarget.getBoundingClientRect(),
                    });
                  }}
                  onBlur={() => setHoveredImage(null)}
                >
                  <span className="h-[18px] w-[18px] shrink-0 overflow-hidden rounded-[5px] bg-muted">
                    <img
                      src={image.previewUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {image.file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeImage(image.previewUrl)}
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-background/60 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                    aria-label={`移除图片 ${image.file.name}`}
                    title={`移除 ${image.file.name}`}
                  >
                    <X className="h-3 w-3" strokeWidth={1.9} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {hoveredImage
            ? (
                <ImageChipPreview
                  src={hoveredImage.src}
                  name={hoveredImage.name}
                  anchorRect={hoveredImage.rect}
                />
              )
            : null}

          <AiComposerInput
            ref={inputRef}
            placeholder={placeholder}
            autoFocusToken={autoFocusToken}
            onSubmit={handleSubmit}
            onEscape={handleEscape}
            onIsEmptyChange={setIsEmpty}
            onReferenceAdded={addReference}
            searchPages={searchPages}
            referencePlacement="external"
            variant="panel"
            disabled={disabled || isStreaming}
          />

          <div className="mt-1.5 flex items-center gap-1">
            <ModelSelectorPopover disabled={disabled} />
            <div className="flex-1" />

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="sr-only"
              onChange={handleImageInput}
              disabled={disabled || isStreaming}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={
                disabled ||
                isStreaming ||
                images.length >= MAX_IMAGE_ATTACHMENTS
              }
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="上传图片"
              title={
                images.length >= MAX_IMAGE_ATTACHMENTS
                  ? `最多 ${MAX_IMAGE_ATTACHMENTS} 张图片`
                  : "上传图片"
              }
            >
              <ImagePlus className="h-4 w-4" strokeWidth={1.75} />
            </button>

            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]",
                  "bg-[var(--goose-interactive-selected)] text-muted-foreground hover:text-foreground",
                  "transition-colors duration-150",
                )}
                aria-label="停止生成"
                title="停止生成"
              >
                <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSend}
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]",
                  "transition-colors duration-150",
                  canSend
                    ? "bg-[#58d7b8]/15 text-[#58d7b8] hover:brightness-110"
                    : "cursor-not-allowed text-muted-foreground opacity-50",
                )}
                aria-label="发送消息"
                title="发送消息"
              >
                <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
