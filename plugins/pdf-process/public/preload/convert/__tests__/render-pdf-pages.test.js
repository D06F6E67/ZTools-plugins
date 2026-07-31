// globals: true
const fs = require('node:fs')
const path = require('node:path')
const { renderPdfPages } = require('../render-pdf-pages.js')

const fixturePath = path.join(__dirname, '..', 'fixtures', 'sample-text.pdf')
const scanPath = 'C:/Users/9206/Downloads/test.pdf'

describe('renderPdfPages', () => {
  it('renders fixture PDF pages to PNG buffers', async () => {
    const pages = await renderPdfPages(fixturePath, { scale: 1.0, maxPages: 2 })
    expect(pages.length).toBe(2)
    expect(pages[0].page).toBe(1)
    expect(Buffer.isBuffer(pages[0].png)).toBe(true)
    // PNG magic
    expect(pages[0].png[0]).toBe(0x89)
    expect(pages[0].png[1]).toBe(0x50)
    expect(pages[0].png.length).toBeGreaterThan(500)
  }, 30000)

  it('renders CamScanner-like PDF when present', async () => {
    if (!fs.existsSync(scanPath)) return
    const pages = await renderPdfPages(scanPath, { scale: 1.2, maxPages: 1 })
    expect(pages.length).toBe(1)
    expect(pages[0].png.length).toBeGreaterThan(10000)
  }, 60000)
})
