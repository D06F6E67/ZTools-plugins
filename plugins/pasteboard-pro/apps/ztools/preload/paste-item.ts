import type { CanonicalClipboardRecord } from "./clipboard-store";
import {
  clipboardWriteSucceeded,
  performDirectPaste,
  type ClipboardPasteHost,
  type DirectPasteResult,
  type DirectPasteTarget,
} from "./privacy";

export function directPasteTarget(
  record: CanonicalClipboardRecord,
  plainText = false,
): DirectPasteTarget {
  const target = canonicalContentTarget(record, plainText);
  if (target !== undefined) return target;
  throw new RangeError("该同步记录只有远端附件，当前设备尚未下载内容");
}

function canonicalContentTarget(
  record: CanonicalClipboardRecord,
  plainText = false,
): DirectPasteTarget | undefined {
  const filePaths = record.item.payload.filePaths?.filter(
    (filePath) => filePath.length > 0,
  );
  if (!plainText && filePaths !== undefined && filePaths.length > 0) {
    return {
      type: "content",
      content: { type: "file", content: filePaths },
    };
  }
  if (
    !plainText &&
    record.item.kind === "image" &&
    record.origin.imagePath !== undefined
  ) {
    return {
      type: "content",
      content: { type: "image", content: record.origin.imagePath },
    };
  }
  const text = record.item.payload.text ?? record.item.ocrText;
  if (text !== undefined) {
    return {
      type: "content",
      content: { type: "text", content: text },
    };
  }
  return undefined;
}

export function pasteCanonicalRecord(
  record: CanonicalClipboardRecord,
  host: ClipboardPasteHost,
  plainText = false,
): Promise<DirectPasteResult> {
  return performDirectPaste(directPasteTarget(record, plainText), host);
}

export async function copyCanonicalRecord(
  record: CanonicalClipboardRecord,
  host: ClipboardPasteHost,
  plainText = false,
): Promise<void> {
  const target = directPasteTarget(record, plainText);
  const result =
    target.type === "host"
      ? await host.write(target.hostItemId, false)
      : await host.writeContent(target.content, false);
  if (clipboardWriteSucceeded(result)) return;
  throw new Error("ZTools 未能复制所选剪贴板内容");
}
