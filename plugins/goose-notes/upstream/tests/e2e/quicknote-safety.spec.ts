import { expect, test } from "playwright/test";

async function openCleanQuickNote(page: import("playwright/test").Page) {
  await page.goto("/quicknote.html");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("radio", { name: "便签 1，空白" })).toBeChecked();
}

test.describe("quick-note draft safety", () => {
  test("fills the remaining viewport without a focus outline", async ({
    page,
  }) => {
    await openCleanQuickNote(page);

    const editor = page.getByRole("textbox").first();
    await editor.focus();

    const layout = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(".quicknote-root");
      const container = document.querySelector<HTMLElement>(".bn-container");
      const editable = document.querySelector<HTMLElement>(".bn-editor");
      if (!root || !container || !editable) return null;

      const rootRect = root.getBoundingClientRect();
      const scrollContainer = root.querySelector<HTMLElement>(
        ".page-scroll-container",
      );
      const containerRect = container.getBoundingClientRect();
      const editorRect = editable.getBoundingClientRect();
      const editorStyle = getComputedStyle(editable);
      return {
        viewportHeight: window.innerHeight,
        rootHeight: rootRect.height,
        scrollClientHeight: scrollContainer?.clientHeight,
        scrollHeight: scrollContainer?.scrollHeight,
        containerBottom: containerRect.bottom,
        editorBottom: editorRect.bottom,
        outlineStyle: editorStyle.outlineStyle,
      };
    });

    expect(layout).not.toBeNull();
    expect(Math.abs(layout!.rootHeight - layout!.viewportHeight)).toBeLessThan(
      1,
    );
    expect(layout!.scrollHeight).toBe(layout!.scrollClientHeight);
    expect(
      Math.abs(layout!.editorBottom - layout!.containerBottom),
    ).toBeLessThan(1);
    expect(layout!.outlineStyle).toBe("none");
  });

  test("scrolls only after the content exceeds the viewport", async ({
    page,
  }) => {
    await openCleanQuickNote(page);

    const editor = page.getByRole("textbox").first();
    await editor.click();
    for (let index = 0; index < 45; index += 1) {
      await page.keyboard.type(`第 ${index + 1} 行`);
      await page.keyboard.press("Enter");
    }

    const overflow = await page
      .locator(".page-scroll-container")
      .evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);
  });

  test("reserves the title row at the minimum editor zoom", async ({
    page,
  }) => {
    await openCleanQuickNote(page);

    const editor = page.getByRole("textbox").first();
    await editor.focus();
    for (let index = 0; index < 3; index += 1) {
      await page.keyboard.press("Control+-");
    }

    const layout = await page.evaluate(() => {
      const titleRow = document.querySelector<HTMLElement>(
        ".quicknote-titlebar-reveal-zone",
      );
      const firstBlock = document.querySelector<HTMLElement>(
        ".quicknote-editor-surface .bn-block-outer",
      );
      const surface = document.querySelector<HTMLElement>(
        ".quicknote-editor-surface",
      );
      if (!titleRow || !firstBlock || !surface) return null;
      return {
        titleBottom: titleRow.getBoundingClientRect().bottom,
        firstBlockTop: firstBlock.getBoundingClientRect().top,
        zoom: getComputedStyle(surface).zoom,
      };
    });

    expect(layout).not.toBeNull();
    expect(layout!.zoom).toBe("0.7");
    expect(layout!.firstBlockTop).toBeGreaterThanOrEqual(layout!.titleBottom);
  });

  test("scrolls the help content when the window is too short", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 160 });
    await openCleanQuickNote(page);

    await page.locator(".quicknote-titlebar-reveal-zone").hover();
    await page.getByRole("button", { name: "使用说明" }).click();

    const overflow = await page
      .locator(".quicknote-help-list")
      .evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: getComputedStyle(element).overflowY,
      }));
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);
    expect(overflow.overflowY).toBe("auto");
  });

  test("renames the active slot from its number and the help menu", async ({
    page,
  }) => {
    await openCleanQuickNote(page);

    await page.getByRole("radio", { name: "便签 1，空白" }).click();
    const renameInput = page.getByRole("textbox", { name: "重命名便签 1" });
    await expect(renameInput).toBeVisible();
    await expect(page.locator(".quicknote-titlebar")).toBeHidden();
    const renameLayout = await renameInput.evaluate((input) => {
      const inputRect = input.getBoundingClientRect();
      const zoneRect = input.parentElement!.getBoundingClientRect();
      return {
        leftGap: inputRect.left - zoneRect.left,
        rightGap: zoneRect.right - inputRect.right,
        width: inputRect.width,
        availableWidth: zoneRect.width,
      };
    });
    expect(renameLayout.leftGap).toBeCloseTo(8, 0);
    expect(renameLayout.rightGap).toBeCloseTo(8, 0);
    expect(renameLayout.width).toBeCloseTo(renameLayout.availableWidth - 16, 0);
    await renameInput.fill("工作");
    await renameInput.press("Enter");

    await page.locator(".page-scroll-container").hover({
      position: { x: 120, y: 120 },
    });
    const slotName = page.locator(".quicknote-slot-name-display");
    await expect(slotName).toHaveText("工作");
    await expect(slotName).toBeVisible();
    const nameStyle = await slotName.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        opacity: style.opacity,
        backgroundColor: style.backgroundColor,
      };
    });
    expect(nameStyle.opacity).toBe("1");
    expect(nameStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");

    await page.reload();
    await page.locator(".page-scroll-container").hover({
      position: { x: 120, y: 120 },
    });
    await expect(slotName).toHaveText("工作");

    await page.locator(".quicknote-titlebar-reveal-zone").hover();
    await page.getByRole("button", { name: "使用说明" }).click();
    await page.getByRole("button", { name: "重命名当前便签" }).click();
    await expect(renameInput).toBeVisible();
    await renameInput.fill("灵感");
    await renameInput.press("Enter");
    await page.locator(".page-scroll-container").hover({
      position: { x: 120, y: 120 },
    });
    await expect(slotName).toHaveText("灵感");
  });

  test("keeps immediate edits across slot changes, undo, popovers, and reload", async ({
    page,
  }) => {
    await openCleanQuickNote(page);

    const editor = page.getByRole("textbox").first();
    await editor.click();
    await editor.pressSequentially("速记切换不会丢失");

    // 不等待编辑器 debounce，立即切换并切回；最新输入必须同步提交。
    await page.keyboard.press("Control+2");
    await expect(
      page.getByRole("radio", { name: "便签 1，有内容" }),
    ).not.toBeChecked();
    await page.keyboard.press("Control+1");
    await expect(editor).toHaveText("速记切换不会丢失");

    // 新输入后立刻走持久化撤销栈，不能被编辑器自身的 debounce 吞掉。
    await editor.pressSequentially("马上撤销");
    await page.keyboard.press("Control+z");
    await expect(editor).toHaveText("速记切换不会丢失");

    const titlebar = page.locator(".quicknote-titlebar-reveal-zone");
    await titlebar.hover();
    await expect(
      page.getByRole("button", { name: "保存到笔记本" }),
    ).toBeVisible();

    // Escape 应先关闭帮助弹层，不能同时收起整个速记窗口。
    await page.getByRole("button", { name: "使用说明" }).click();
    await expect(page.getByText("速记便签", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("速记便签", { exact: true })).toBeHidden();
    await expect(editor).toBeVisible();

    await page.reload();
    await expect(page.getByRole("textbox").first()).toHaveText(
      "速记切换不会丢失",
    );
    await expect(
      page.getByRole("radio", { name: "便签 1，有内容" }),
    ).toBeChecked();
  });
});
