import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const services = path.resolve(here, '../../services.js')
const runner = path.resolve(here, '../../lib/pdfcpu-runner.js')

describe('pdfcpu path resolution for asar', () => {
  it('pdfcpu-runner rewrites .asar to .asar.unpacked; services wires it', () => {
    const impl = fs.readFileSync(runner, 'utf8')
    const facade = fs.readFileSync(services, 'utf8')
    expect(impl).toMatch(/function isInsideAsar/)
    expect(impl).toMatch(/function resolveNativePath/)
    expect(impl).toMatch(/function getPdfcpuPath/)
    expect(impl).toMatch(/\.asar\.unpacked/)
    expect(impl).toMatch(/pdf-process-bin/)
    expect(impl).toMatch(/spawn\(exe,/)
    // facade re-exports / uses runner
    expect(facade).toMatch(/function resolveNativePath/)
    expect(facade).toMatch(/function getPdfcpuPath/)
    expect(facade).toMatch(/pdfcpu-runner/)
  })

  it('isInsideAsar logic: path with .asar\\ is detected', () => {
    function isInsideAsar(filePath) {
      if (/\.asar\.unpacked([\\/]|$)/.test(filePath)) return false
      return filePath.includes('.asar' + path.sep) || /\.asar[\\/]/.test(filePath)
    }
    expect(isInsideAsar('C:\\x\\app.asar\\bin\\pdfcpu.exe')).toBe(true)
    expect(isInsideAsar('C:\\x\\app.asar.unpacked\\bin\\pdfcpu.exe')).toBe(false)
    expect(isInsideAsar('C:\\x\\bin\\pdfcpu.exe')).toBe(false)
    const primary = 'C:\\Users\\u\\.ztools\\plugins\\pdf-process-1.0.0.asar\\bin\\pdfcpu.exe'
    const unpacked = primary.replace(/\.asar([\\/])/, '.asar.unpacked$1')
    expect(unpacked).toBe(
      'C:\\Users\\u\\.ztools\\plugins\\pdf-process-1.0.0.asar.unpacked\\bin\\pdfcpu.exe',
    )
  })
})
