import { expect, test } from "playwright/test";
import { getShortcutFromKeyEvent } from "../../src/pages/workspace/components/sidebar/settings/ShortcutField";
import {
  getAllConfiguredShortcuts,
  normalizeShortcutForConflict,
} from "../../src/pages/workspace/components/sidebar/settings/SettingsShortcuts";
import { getFixedAppShortcuts } from "../../src/lib/fixed-app-shortcuts";
import { DEFAULT_APP_SHORTCUTS } from "../../src/stores/settings/slices/shortcutsSlice";

function shortcutEvent(init: {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}) {
  return {
    key: init.key,
    code: init.code ?? "",
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    preventDefault() {},
    stopPropagation() {},
  };
}

test("shortcut recorder supports Space and ignores modifier-only input", () => {
  expect(getShortcutFromKeyEvent(shortcutEvent({ key: " ", code: "Space" }))).toBe("Space");
  expect(
    getShortcutFromKeyEvent(
      shortcutEvent({ key: " ", code: "Space", metaKey: true, shiftKey: true }),
    ),
  ).toBe("Meta+Shift+Space");
  expect(getShortcutFromKeyEvent(shortcutEvent({ key: "Meta", metaKey: true }))).toBe("");
  expect(getShortcutFromKeyEvent(shortcutEvent({ key: "Control", ctrlKey: true }))).toBe("");
});

test("shortcut recorder keeps the plus key unambiguous", () => {
  expect(
    getShortcutFromKeyEvent(
      shortcutEvent({ key: "+", code: "Equal", shiftKey: true }),
    ),
  ).toBe("Shift+Plus");
});

test("conflict normalization aligns Mod with the current platform primary modifier", () => {
  expect(normalizeShortcutForConflict("Mod+K", true)).toBe(
    normalizeShortcutForConflict("Meta+K", true),
  );
  expect(normalizeShortcutForConflict("Mod+K", false)).toBe(
    normalizeShortcutForConflict("Ctrl+K", false),
  );
  expect(normalizeShortcutForConflict("Shift+Ctrl+K", false)).toBe(
    normalizeShortcutForConflict("Control+Shift+K", false),
  );
});

test("configured shortcut conflicts include fixed shortcuts", () => {
  const configured = getAllConfiguredShortcuts({}, "", "", "unused");
  expect(configured).toContain(normalizeShortcutForConflict("Mod+N"));
  expect(configured).toContain(normalizeShortcutForConflict("Mod+F"));
  expect(configured).toContain(normalizeShortcutForConflict("Mod+Shift+T"));
  expect(configured).toContain(normalizeShortcutForConflict("Mod+1"));
  expect(configured).toContain(normalizeShortcutForConflict("Ctrl+Tab"));
  expect(configured).toContain(normalizeShortcutForConflict("Mod+Shift+G"));
  expect(configured).toContain(normalizeShortcutForConflict("Shift+F3"));
});

test("fixed shortcuts adapt to the current operating system", () => {
  expect(getFixedAppShortcuts("mac").openSettings).toBe("Ctrl+,");
  expect(getFixedAppShortcuts("windows").openSettings).toBe("Alt+,");
  expect(getFixedAppShortcuts("linux").openSettings).toBe("Alt+,");
  expect(getFixedAppShortcuts("mac").reopenTab).toBe("Mod+Shift+T");
  expect(DEFAULT_APP_SHORTCUTS).not.toHaveProperty("newNote");
  expect(DEFAULT_APP_SHORTCUTS).not.toHaveProperty("saveNote");
  expect(DEFAULT_APP_SHORTCUTS).not.toHaveProperty("reopenTab");
});
