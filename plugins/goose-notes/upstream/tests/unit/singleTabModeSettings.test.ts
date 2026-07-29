import { expect, test } from "playwright/test";
import { APPEARANCE_INITIAL_STATE } from "../../src/stores/settings/slices/appearanceSlice";
import { migrateSettingsPersistedState } from "../../src/stores/settings/migrations";

test("全新用户默认开启极简工作区", () => {
  expect(APPEARANCE_INITIAL_STATE.singleTabMode).toBe(true);
});

test("老用户没有模式字段时继续保留多标签", () => {
  expect(migrateSettingsPersistedState({ theme: "dark" })).toMatchObject({
    theme: "dark",
    singleTabMode: false,
  });
});

test("已有明确选择不会被迁移覆盖", () => {
  expect(
    migrateSettingsPersistedState({ singleTabMode: true }).singleTabMode,
  ).toBe(true);
  expect(
    migrateSettingsPersistedState({ singleTabMode: false }).singleTabMode,
  ).toBe(false);
});
