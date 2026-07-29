import { expect, test } from "playwright/test";
import {
  calculateSafePixelRatio,
  getCapturePixelRatios,
} from "../../src/lib/imageExport/renderer";

test("图片导出比例同时受边长和总像素限制", () => {
  expect(calculateSafePixelRatio(1_200, 800)).toBe(3);

  const longRatio = calculateSafePixelRatio(1_000, 100_000);
  expect(Math.ceil(100_000 * longRatio)).toBeLessThanOrEqual(16_384);
  expect(
    Math.ceil(1_000 * longRatio) * Math.ceil(100_000 * longRatio),
  ).toBeLessThanOrEqual(16_000_000);

  const wideRatio = calculateSafePixelRatio(20_000, 20_000);
  expect(
    Math.ceil(20_000 * wideRatio) * Math.ceil(20_000 * wideRatio),
  ).toBeLessThanOrEqual(16_000_000);
});

test("连续导出失败时会按较低倍率重试", () => {
  expect(getCapturePixelRatios(1_200, 800)).toEqual([3, 2, 1]);

  const constrainedRatios = getCapturePixelRatios(1_000, 100_000);
  expect(constrainedRatios[0]).toBe(calculateSafePixelRatio(1_000, 100_000));
  expect(constrainedRatios).toEqual([0.1638, 0.1228, 0.1]);
});

test("过长内容不会用 0.1 下限突破画布安全边长", () => {
  expect(() => calculateSafePixelRatio(1_000, 200_000)).toThrow(
    "无法导出为单张图片",
  );
});
