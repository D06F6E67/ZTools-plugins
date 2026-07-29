import { expect, test } from "playwright/test";
import { getQuickNoteSlotShortcut } from "../../src/pages/quick-note/quickNoteShortcuts";

function shortcutEvent(
  overrides: Partial<Parameters<typeof getQuickNoteSlotShortcut>[0]>,
): Parameters<typeof getQuickNoteSlotShortcut>[0] {
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    ...overrides,
  };
}

test("Windows Alt+1–5 switches quick-note slots", () => {
  for (const slot of [1, 2, 3, 4, 5] as const) {
    expect(
      getQuickNoteSlotShortcut(
        shortcutEvent({
          key: String(slot),
          code: `Digit${slot}`,
          altKey: true,
        }),
        true,
      ),
    ).toBe(slot);
  }
});

test("slot shortcuts use Digit code when Alt changes the produced character", () => {
  expect(
    getQuickNoteSlotShortcut(
      shortcutEvent({ key: "¡", code: "Digit1", altKey: true }),
      true,
    ),
  ).toBe(1);
});

test("Alt slot shortcut stays Windows-only and ignores unsafe modifier states", () => {
  const altOne = shortcutEvent({ key: "1", code: "Digit1", altKey: true });
  expect(getQuickNoteSlotShortcut(altOne, false)).toBeNull();
  expect(
    getQuickNoteSlotShortcut({ ...altOne, ctrlKey: true }, true),
  ).toBeNull();
  expect(
    getQuickNoteSlotShortcut({ ...altOne, shiftKey: true }, true),
  ).toBeNull();
  expect(
    getQuickNoteSlotShortcut({ ...altOne, repeat: true }, true),
  ).toBeNull();
});

test("existing Cmd/Ctrl slot shortcuts remain available", () => {
  expect(
    getQuickNoteSlotShortcut(
      shortcutEvent({ key: "2", code: "Digit2", metaKey: true }),
      false,
    ),
  ).toBe(2);
  expect(
    getQuickNoteSlotShortcut(
      shortcutEvent({ key: "3", code: "Digit3", ctrlKey: true }),
      true,
    ),
  ).toBe(3);
});
