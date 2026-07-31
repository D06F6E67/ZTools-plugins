import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginJson = path.resolve(here, '../../../plugin.json')

/** Minimal matchBase:true for patterns like *.{exe,dll,node} or *.node */
function matchBase(filePath, pattern) {
  const base = filePath.split('/').pop()
  // brace expand *.{exe,dll,node}
  const m = pattern.match(/^\*\.\{([^}]+)\}$/)
  if (m) {
    const exts = m[1].split(',')
    return exts.some((ext) => base.endsWith('.' + ext))
  }
  if (pattern === '*.node') return base.endsWith('.node')
  if (pattern.startsWith('*.')) return base.endsWith(pattern.slice(1))
  return filePath === pattern || base === pattern
}

function findUnpackMatches(files, unpackValue) {
  const patterns = [
    files.some((filePath) => filePath.endsWith('.node')) ? '*.node' : undefined,
    unpackValue || undefined,
  ].filter(Boolean)
  return files.filter((filePath) => patterns.some((pattern) => matchBase(filePath, pattern)))
}

describe('plugin.json unpack (ZTools scheme A)', () => {
  it('declares unpack so pdfcpu.exe lands in asar.unpacked', () => {
    const cfg = JSON.parse(fs.readFileSync(pluginJson, 'utf8'))
    expect(typeof cfg.unpack).toBe('string')
    expect(cfg.unpack).toMatch(/exe/)

    const files = [
      'bin/pdfcpu.exe',
      'bin/7za.exe',
      'preload/services.js',
      'index.html',
      'preload/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node',
    ]
    const matched = findUnpackMatches(files, cfg.unpack)
    expect(matched).toContain('bin/pdfcpu.exe')
    expect(matched).toContain('bin/7za.exe')
    expect(matched.some((f) => f.endsWith('.node'))).toBe(true)
    expect(matched).not.toContain('preload/services.js')
  })
})
