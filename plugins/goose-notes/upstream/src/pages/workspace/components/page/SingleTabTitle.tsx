import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/sonner";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { usePages } from "@/stores/usePages";
import type { Page } from "@/types";
import {
  completePageTitleFocus,
  isPageTitleFocusRequested,
  subscribePageTitleFocus,
} from "@/lib/page-title-focus";

interface SingleTabTitleProps {
  page: Page;
}

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/;

function withInternalPageTitle(page: Page, title: string) {
  const content = structuredClone(page.content);
  if (!Array.isArray(content)) return content;

  const titleBlock = {
    type: "heading",
    props: { level: 1 },
    content: title,
  };
  const first = content[0] as
    | { type?: string; props?: { level?: number }; attrs?: { level?: number } }
    | undefined;

  if (
    first?.type === "heading" &&
    (first.props?.level === 1 || first.attrs?.level === 1)
  ) {
    content[0] = { ...content[0], content: title };
  } else {
    content.unshift(titleBlock);
  }
  return content;
}

export function SingleTabTitle({ page }: SingleTabTitleProps) {
  const currentTitle = getPageTitle(page);
  const [initiallyFocused] = useState(() =>
    isPageTitleFocusRequested(page.id),
  );
  const [value, setValue] = useState(
    initiallyFocused ? "" : currentTitle,
  );
  const [allowUntitledSubmit, setAllowUntitledSubmit] = useState(
    initiallyFocused,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const committingRef = useRef(false);
  const skipNextBlurCommitRef = useRef(false);

  const focusAsNewPage = useCallback(() => {
    setValue("");
    setAllowUntitledSubmit(true);
  }, []);

  useEffect(() => {
    const timers: number[] = [];
    const scheduleStableFocus = () => {
      [0, 50, 150, 300, 600].forEach((delay, index, delays) => {
        timers.push(
          window.setTimeout(() => {
            if (!isPageTitleFocusRequested(page.id)) return;
            const input = inputRef.current;
            if (!input?.isConnected) return;
            input.focus({ preventScroll: true });
            if (
              index === delays.length - 1 &&
              document.activeElement === input
            ) {
              completePageTitleFocus(page.id);
            }
          }, delay),
        );
      });
    };

    if (initiallyFocused && isPageTitleFocusRequested(page.id)) {
      scheduleStableFocus();
    }
    const unsubscribe = subscribePageTitleFocus((pageId) => {
      if (pageId === page.id && isPageTitleFocusRequested(page.id)) {
        focusAsNewPage();
        scheduleStableFocus();
      }
    });
    return () => {
      unsubscribe();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [focusAsNewPage, initiallyFocused, page.id]);

  const commit = useCallback(async (moveToBody = false) => {
    if (committingRef.current) return;
    const nextTitle = value.trim();
    if (!nextTitle) {
      if (allowUntitledSubmit) {
        setValue(currentTitle);
        setAllowUntitledSubmit(false);
        if (moveToBody) {
          window.dispatchEvent(new CustomEvent("goose-note:focus-editor-body"));
        }
        return;
      }
      toast.error("标题不能为空，请输入名称");
      inputRef.current?.focus();
      return;
    }
    if (INVALID_FILENAME_CHARS.test(nextTitle)) {
      toast.error('标题不能包含 \\ / : * ? " < > |');
      inputRef.current?.focus();
      return;
    }
    if (nextTitle === currentTitle) {
      setValue(nextTitle);
      return;
    }

    committingRef.current = true;
    try {
      if (page.localFilePath) {
        await usePages.getState().renameLocalPageFile(page.id, nextTitle);
      } else {
        usePages.getState().updatePage(page.id, {
          content: withInternalPageTitle(page, nextTitle),
        });
      }
      setValue(nextTitle);
      setAllowUntitledSubmit(false);
      if (moveToBody) {
        window.dispatchEvent(new CustomEvent("goose-note:focus-editor-body"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (page.localFilePath && message.includes("同名")) {
        toast.error("名称已存在", {
          description: "请返回修改，或自动添加序号后保存。",
          action: {
            label: "自动添加序号",
            onClick: () => {
              void (async () => {
                for (let index = 2; index <= 99; index += 1) {
                  const numberedTitle = `${nextTitle} ${index}`;
                  try {
                    await usePages
                      .getState()
                      .renameLocalPageFile(page.id, numberedTitle);
                    setValue(numberedTitle);
                    return;
                  } catch (numberedError) {
                    const numberedMessage =
                      numberedError instanceof Error
                        ? numberedError.message
                        : String(numberedError);
                    if (!numberedMessage.includes("同名")) {
                      toast.error("重命名失败", {
                        description: numberedMessage,
                      });
                      return;
                    }
                  }
                }
                toast.error("无法生成可用名称，请手动修改");
              })();
            },
          },
        });
      } else {
        toast.error("重命名失败", { description: message });
      }
      inputRef.current?.focus();
    } finally {
      committingRef.current = false;
    }
  }, [allowUntitledSubmit, currentTitle, page, value]);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        // 新建页切换期间编辑器会短暂抢焦；聚焦请求尚未完成时忽略这次
        // 程序性 blur，避免把空输入提前恢复为“无标题”。
        if (isPageTitleFocusRequested(page.id)) return;
        if (skipNextBlurCommitRef.current) {
          skipNextBlurCommitRef.current = false;
          return;
        }
        void commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          skipNextBlurCommitRef.current = true;
          event.currentTarget.blur();
          void commit(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          setValue(currentTitle);
          setAllowUntitledSubmit(false);
          skipNextBlurCommitRef.current = true;
          event.currentTarget.blur();
        }
      }}
      aria-label="笔记标题"
      title="点击编辑笔记标题"
      spellCheck={false}
      autoComplete="off"
      autoFocus={initiallyFocused}
      className="h-8 min-w-0 flex-1 rounded-[7px] border border-transparent bg-transparent px-2 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-[var(--goose-interactive-hover)] focus:border-primary/45 focus:bg-[hsl(var(--goose-editor-bg))] focus:ring-2 focus:ring-primary/15"
    />
  );
}
