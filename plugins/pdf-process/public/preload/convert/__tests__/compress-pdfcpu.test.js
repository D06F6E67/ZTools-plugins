import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const services = path.resolve(here, '../../services.js')

describe('compressPdf uses pdfcpu', () => {
  it('services.js uses pdfcpu optimize and does not call presse', () => {
    const src = fs.readFileSync(services, 'utf8')
    expect(src).not.toMatch(/PRESSE_PATH/)
    expect(src).not.toMatch(/callPresse/)
    const m = src.match(/async compressPdf[\s\S]*?async mergePdfs/)
    expect(m).toBeTruthy()
    expect(m[0]).toMatch(/callPdfcpu\(\['optimize'/)
    expect(m[0]).not.toMatch(/presse/i)
  })
})
