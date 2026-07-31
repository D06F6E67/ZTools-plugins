const fs = require('node:fs')
const path = require('node:path')
// Prevent @napi-rs/canvas from auto-loading system fonts (Electron Path error)
process.env.DISABLE_SYSTEM_FONTS_LOAD = '1'
const { pathToFileURL } = require('node:url')
const { configureWorker, buildGetDocumentParams, loadPdfjs } = require('./extract-pdf-text')

const DEFAULT_SCALE = 1.5
const MAX_PAGES = 30

/**
 * Node/Electron canvas factory for pdfjs page.render.
 * Requires @napi-rs/canvas.
 */
function createNodeCanvasFactory() {
  let createCanvas
  try {
    ;({ createCanvas } = require('@napi-rs/canvas'))
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND') {
      throw new Error('渲染 PDF 页需要 @napi-rs/canvas，请在 public/preload 执行 npm install')
    }
    throw e
  }
  return {
    create(width, height) {
      const canvas = createCanvas(Math.ceil(width), Math.ceil(height))
      return {
        canvas,
        context: canvas.getContext('2d'),
      }
    },
    reset(canvasAndContext, width, height) {
      canvasAndContext.canvas.width = Math.ceil(width)
      canvasAndContext.canvas.height = Math.ceil(height)
    },
    destroy(canvasAndContext) {
      canvasAndContext.canvas.width = 0
      canvasAndContext.canvas.height = 0
    },
  }
}

/**
 * Render each PDF page to a PNG buffer (for vision models).
 * @param {string} inputPath
 * @param {{ scale?: number, maxPages?: number }} [opts]
 * @returns {Promise<Array<{ page: number, png: Buffer, width: number, height: number }>>}
 */
async function renderPdfPages(inputPath, opts = {}) {
  if (!fs.existsSync(inputPath)) {
    throw new Error('输入文件不存在: ' + inputPath)
  }
  const scale = typeof opts.scale === 'number' && opts.scale > 0 ? opts.scale : DEFAULT_SCALE
  const maxPages = typeof opts.maxPages === 'number' ? opts.maxPages : MAX_PAGES

  const pdfjs = await loadPdfjs()
  configureWorker(pdfjs)

  const data = new Uint8Array(fs.readFileSync(inputPath))
  const params = buildGetDocumentParams(data)
  const canvasFactory = createNodeCanvasFactory()
  params.canvasFactory = canvasFactory

  const loadingTask = pdfjs.getDocument(params)
  const pdf = await loadingTask.promise
  try {
    const n = Math.min(pdf.numPages, maxPages)
    const pages = []
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale })
      const canvasAndContext = canvasFactory.create(viewport.width, viewport.height)
      try {
        await page.render({
          canvasContext: canvasAndContext.context,
          viewport,
          canvas: canvasAndContext.canvas,
        }).promise
        const png = canvasAndContext.canvas.toBuffer('image/png')
        pages.push({
          page: i,
          png,
          width: viewport.width,
          height: viewport.height,
        })
      } finally {
        canvasFactory.destroy(canvasAndContext)
      }
    }
    return pages
  } finally {
    try {
      await pdf.destroy()
    } catch {
      // ignore
    }
  }
}

module.exports = {
  renderPdfPages,
  createNodeCanvasFactory,
  DEFAULT_SCALE,
  MAX_PAGES,
}
