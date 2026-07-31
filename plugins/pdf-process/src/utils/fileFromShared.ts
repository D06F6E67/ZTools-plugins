import type { SharedFile } from '../context/SharedFilesContext'

/** Build a browser File from a workspace entry (drag/drop or path-only open dialog). */
export async function ensureBrowserFile(file: SharedFile): Promise<File> {
  if (file.rawFile) return file.rawFile
  const p = file.path
  if (!p) throw new Error('无效文件路径')
  if (typeof window.services.readFileBase64 !== 'function') {
    throw new Error('请拖入 PDF 文件（当前环境无法读取路径文件）')
  }
  const b64 = window.services.readFileBase64(p)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], file.name || 'document.pdf', { type: 'application/pdf' })
}

export function fileFromBase64(
  b64: string,
  name: string,
  type = 'application/pdf',
): File {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name || 'document.pdf', { type })
}
