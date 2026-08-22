import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  GifOptions,
  ImageJobSettings,
  MergeImagesOptions,
  SharpRuntimeProgress,
  SourceFile
} from "../shared/types";
import { imageDataUrlToBuffer } from "./data-url";
import { createGif, mergeImages, mergePdfs, processImages } from "./processor";
import { discoverFiles } from "./file-discovery";
import {
  installSharpRuntime,
  sharpRuntimeStatus
} from "./sharp-runtime";

declare global {
  interface Window {
    ztools: any;
    services: typeof services;
  }
}

const electron = require("electron");
const { shell, webUtils } = electron;

const tempRoot = path.join(getZToolsPath("temp"), "image-batch-studio");

function getZToolsPath(name: string): string {
  if (typeof window !== "undefined" && window.ztools?.getPath) {
    return window.ztools.getPath(name);
  }
  const os = require("node:os");
  if (name === "temp") return os.tmpdir();
  if (name === "desktop") return path.join(os.homedir(), "Desktop");
  return os.homedir();
}

function payloadPaths(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item: any) => item?.path || item?.filePath || item)
    .filter((item): item is string => typeof item === "string" && item.length > 0);
}

async function imagePayloadToFile(payload: unknown): Promise<string[]> {
  if (typeof payload !== "string" || !payload.startsWith("data:image/")) return [];
  await fs.mkdir(tempRoot, { recursive: true });
  const image = imageDataUrlToBuffer(payload);
  const filePath = path.join(tempRoot, `pasted-${Date.now()}.${image.ext}`);
  await fs.writeFile(filePath, image.buffer);
  return [filePath];
}

async function resolveLaunchFiles(action: any): Promise<SourceFile[]> {
  const directPaths = payloadPaths(action?.payload);
  const imagePaths = action?.type === "img" ? await imagePayloadToFile(action?.payload) : [];
  if (directPaths.length > 0 || imagePaths.length > 0) await ensureSharpRuntime();
  return discoverFiles([...directPaths, ...imagePaths]);
}

function dispatchRuntimeProgress(progress: SharpRuntimeProgress) {
  window.dispatchEvent(new CustomEvent("image-batch-runtime-progress", { detail: progress }));
}

async function ensureSharpRuntime() {
  const current = await sharpRuntimeStatus();
  if (current.state === "ready") return current;
  if (current.state === "unsupported") {
    throw new Error(`当前平台暂不支持图像运行组件：${current.target}`);
  }
  const installed = await installSharpRuntime(dispatchRuntimeProgress);
  window.dispatchEvent(new CustomEvent("image-batch-runtime-status", { detail: installed }));
  if (installed.state !== "ready") {
    throw new Error(installed.error || "图像运行组件安装失败");
  }
  return installed;
}

async function notifyEnter(action: any) {
  const files = await resolveLaunchFiles(action);
  if (files.length > 0) {
    window.dispatchEvent(new CustomEvent("image-batch-enter", { detail: { files, action } }));
  }
}

const services = {
  async handlePluginEnter(action: any) {
    await notifyEnter(action);
  },

  async resolveFiles(paths: string[]) {
    if (paths.length > 0) await ensureSharpRuntime();
    return discoverFiles(paths);
  },

  runtimeStatus() {
    return sharpRuntimeStatus();
  },

  async installRuntime() {
    const status = await installSharpRuntime(dispatchRuntimeProgress);
    window.dispatchEvent(new CustomEvent("image-batch-runtime-status", { detail: status }));
    return status;
  },

  async processImages(paths: string[], settings: ImageJobSettings) {
    await ensureSharpRuntime();
    return processImages(paths, settings, (completed, total, result) => {
      window.dispatchEvent(
        new CustomEvent("image-batch-progress", {
          detail: { completed, total, result }
        })
      );
    });
  },

  async mergePdfs(paths: string[], outputPath: string) {
    return mergePdfs(paths, outputPath);
  },

  async mergeImages(paths: string[], outputPath: string, options: MergeImagesOptions) {
    await ensureSharpRuntime();
    return mergeImages(paths, outputPath, options);
  },

  async createGif(paths: string[], outputPath: string, options: GifOptions) {
    await ensureSharpRuntime();
    return createGif(paths, outputPath, options);
  },

  async chooseFiles() {
    const paths = window.ztools.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Images and PDFs", extensions: ["jpg", "jpeg", "png", "webp", "avif", "heif", "heic", "tiff", "gif", "pdf"] }
      ]
    });
    if (!paths?.length) return [];
    await ensureSharpRuntime();
    return discoverFiles(paths);
  },

  async chooseDirectory() {
    const paths = window.ztools.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    return paths?.[0];
  },

  async chooseWatermarkImage() {
    const paths = window.ztools.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "avif", "heif", "heic", "tiff"] }]
    });
    return paths?.[0];
  },

  async savePath(defaultPath: string, extensions: string[]) {
    return window.ztools.showSaveDialog({
      defaultPath,
      filters: [{ name: extensions.join(", ").toUpperCase(), extensions }]
    });
  },

  getDefaultOutputDirectory() {
    return path.join(getZToolsPath("desktop"), "ZTools 图片批处理");
  },

  fileUrl(filePath: string) {
    return pathToFileURL(filePath).toString();
  },

  getPathForFile(file: File) {
    if (window.ztools?.getPathForFile) return window.ztools.getPathForFile(file);
    return webUtils.getPathForFile(file);
  },

  reveal(filePath: string) {
    shell.showItemInFolder(filePath);
  }
};

window.services = services;

if (window.ztools?.onPluginEnter) {
  window.ztools.onPluginEnter((action: any) => {
    services.handlePluginEnter(action).catch((error: unknown) => {
      window.ztools.showNotification?.(error instanceof Error ? error.message : String(error));
    });
  });
}

if (window.ztools?.onPluginOut) {
  window.ztools.onPluginOut(async (isKill: boolean) => {
    if (!isKill) return;
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  });
}
