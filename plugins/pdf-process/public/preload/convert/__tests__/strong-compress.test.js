/**
 * Behavioral test for strong-compress (the real Electron failure mode).
 * Simulates preload globals: window present, rAF missing until polyfilled,
 * Chinese paths, and DISABLE_SYSTEM_FONTS_LOAD.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const sampleCandidates = [
  path.resolve(here, '../../../../MicrosoftYaHei_BMP.pdf'),
  path.resolve(here, '../../../../public/preload/convert/fixtures'),
]

function findSamplePdf() {
  for (const c of sampleCandidates) {
    if (fs.existsSync(c) && c.endsWith('.pdf')) return c
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
      const hit = fs.readdirSync(c).find((f) => f.toLowerCase().endsWith('.pdf'))
      if (hit) return path.join(c, hit)
    }
  }
  // any pdf in repo root
  const root = path.resolve(here, '../../../..')
  const hit = fs.readdirSync(root).find((f) => f.toLowerCase().endsWith('.pdf'))
  return hit ? path.join(root, hit) : null
}

describe('strongCompressPdf', () => {
  const sample = findSamplePdf()

  beforeAll(() => {
    process.env.DISABLE_SYSTEM_FONTS_LOAD = '1'
    // Electron-like: window exists
    globalThis.window = globalThis
  })

  it('module sets DISABLE_SYSTEM_FONTS_LOAD before canvas load', () => {
    const src = fs.readFileSync(
      path.resolve(here, '../../lib/strong-compress.js'),
      'utf8',
    )
    const disableIdx = src.indexOf("DISABLE_SYSTEM_FONTS_LOAD = '1'")
    const requireCanvasIdx = src.indexOf("require('@napi-rs/canvas')")
    expect(disableIdx).toBeGreaterThanOrEqual(0)
    expect(requireCanvasIdx).toBeGreaterThan(disableIdx)
  })

  it(
    'compresses a real PDF including Chinese temp paths',
    async () => {
      if (!sample) {
        console.warn('skip: no sample PDF')
        return
      }
      const { strongCompressPdf } = require('../../lib/strong-compress.js')
      const base = fs.mkdtempSync(path.join(os.tmpdir(), '强压-'))
      const input = path.join(base, 'mx-space部署.pdf')
      fs.copyFileSync(sample, input)
      const output = path.join(base, 'out.pdf')
      const tempDir = path.join(base, 'pages')

      await strongCompressPdf({
        inputPath: input,
        outputPath: output,
        tempDir,
        quality: 40,
      })

      expect(fs.existsSync(output)).toBe(true)
      const size = fs.statSync(output).size
      expect(size).toBeGreaterThan(1000)
      // should be a PDF
      const head = fs.readFileSync(output).subarray(0, 5).toString('utf8')
      expect(head).toBe('%PDF-')
    },
    120_000,
  )
})
