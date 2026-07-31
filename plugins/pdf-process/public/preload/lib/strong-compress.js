/**
 * Strong-compress: rasterize PDF at target DPI → JPEG pages → single PDF.
 *
 * MUST set DISABLE_SYSTEM_FONTS_LOAD before requiring @napi-rs/canvas.
 * That package auto-loads system fonts on import via loadFontsFromDir(homedir...),
 * which throws "Value is non of these types String, Path" in some Electron/asar hosts.
 */
process.env.DISABLE_SYSTEM_FONTS_LOAD = '1'

const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createPdfFromImages } = require('./create-pdf-from-images')

function mapQualityToRaster(quality) {
  const q = Math.min(100, Math.max(1, Number(quality) || 1))
  const t = (q - 1) / 99
  const dpi = Math.round(72 + t * (150 - 72))
  const jpegQuality = 0.32 + t * 0.4
  const grayscale = q < 35
  return { dpi, jpegQuality, grayscale }
}

const STRONG_MAX_LONG_EDGE_PX = 2000
const MAX_PAGES = 500

function asPathString(p) {
  if (typeof p === 'string') return p
  if (p == null) return ''
  try {
    return String(p)
  } catch {
    return ''
  }
}

/** Electron preload has window but may lack rAF — pdfjs render needs it. */
function ensureAnimationFrame() {
  const g = typeof globalThis !== 'undefined' ? globalThis : global
  if (typeof g.requestAnimationFrame !== 'function') {
    g.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0)
  }
  if (typeof g.cancelAnimationFrame !== 'function') {
    g.cancelAnimationFrame = (id) => clearTimeout(id)
  }
  // Also patch window if it exists as a separate object
  if (typeof window !== 'undefined') {
    if (typeof window.requestAnimationFrame !== 'function') {
      window.requestAnimationFrame = g.requestAnimationFrame
    }
    if (typeof window.cancelAnimationFrame !== 'function') {
      window.cancelAnimationFrame = g.cancelAnimationFrame
    }
  }
}

function createNodeCanvasFactory() {
  // Lazy require AFTER DISABLE_SYSTEM_FONTS_LOAD
  const { createCanvas } = require('@napi-rs/canvas')
  return {
    create(width, height) {
      const w = Math.max(1, Math.ceil(Number(width) || 1))
      const h = Math.max(1, Math.ceil(Number(height) || 1))
      const canvas = createCanvas(w, h)
      return { canvas, context: canvas.getContext('2d') }
    },
    reset(canvasAndContext, width, height) {
      canvasAndContext.canvas.width = Math.max(1, Math.ceil(Number(width) || 1))
      canvasAndContext.canvas.height = Math.max(1, Math.ceil(Number(height) || 1))
    },
    destroy(canvasAndContext) {
      try {
        canvasAndContext.canvas.width = 0
        canvasAndContext.canvas.height = 0
      } catch {}
    },
  }
}

function canvasToJpeg(canvas, quality01) {
  const q = Math.min(1, Math.max(0.05, Number(quality01) || 0.5))
  try {
    return canvas.toBuffer('image/jpeg', q)
  } catch {
    try {
      return canvas.toBuffer('image/jpeg', { quality: q })
    } catch {
      return canvas.toBuffer('image/jpeg')
    }
  }
}

/**
 * Real browser/Electron Worker vs Node FakeWorker.
 * FakeWorker only supports file:/data:/node: URLs — never blob:.
 */
function canUseRealWorker() {
  if (typeof Worker === 'undefined') return false
  try {
    // Node 20+ experimental Worker is not the browser one; pdfjs FakeWorker path is safer.
    const isElectron =
      !!(process.versions && process.versions.electron) ||
      !!(typeof window !== 'undefined' && window.process && window.process.type)
    return isElectron
  } catch {
    return false
  }
}

async function loadPdfjsForRender() {
  const {
    resolveWorkerPath,
    resolvePdfjsAssetDirs,
    FsCMapReaderFactory,
    FsStandardFontDataFactory,
  } = require('../convert/extract-pdf-text')

  ensureAnimationFrame()

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

  let workerPath = asPathString(resolveWorkerPath())
  if (!fs.existsSync(workerPath)) {
    throw new Error('pdfjs worker 不存在: ' + workerPath)
  }

  // Always copy out of asar — Worker and FakeWorker both choke on asar internals
  if (workerPath.includes('.asar')) {
    const os = require('node:os')
    const dest = path.join(asPathString(os.tmpdir()), 'pdf-process-pdf.worker.mjs')
    fs.copyFileSync(workerPath, dest)
    workerPath = dest
  }

  // MUST be a plain string URL. Never pass Path objects. Never use blob: on FakeWorker.
  const fileUrl = pathToFileURL(workerPath).href
  if (canUseRealWorker() && typeof Blob !== 'undefined' && URL.createObjectURL) {
    try {
      const code = fs.readFileSync(workerPath)
      const bytes = new Uint8Array(code.buffer, code.byteOffset, code.byteLength)
      pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
        new Blob([bytes], { type: 'text/javascript' }),
      )
    } catch {
      pdfjs.GlobalWorkerOptions.workerSrc = fileUrl
    }
  } else {
    pdfjs.GlobalWorkerOptions.workerSrc = fileUrl
  }

  const { cMapDir, standardFontDir } = resolvePdfjsAssetDirs()

  function buildParams(data) {
    const params = {
      data,
      cMapUrl: asPathString(cMapDir),
      cMapPacked: true,
      CMapReaderFactory: FsCMapReaderFactory,
      useSystemFonts: false,
      isEvalSupported: false,
      useWorkerFetch: false,
      disableFontFace: true,
      isOffscreenCanvasSupported: false,
      verbosity: 0,
    }
    try {
      if (fs.existsSync(asPathString(standardFontDir))) {
        params.standardFontDataUrl = asPathString(standardFontDir)
        params.StandardFontDataFactory = FsStandardFontDataFactory
      }
    } catch {}
    return params
  }

  return { pdfjs, buildParams }
}

/**
 * @param {{
 *   inputPath: string,
 *   outputPath: string,
 *   quality?: number,
 *   tempDir: string,
 *   log?: Function,
 * }} opts
 */
async function strongCompressPdf(opts) {
  // Belt-and-suspenders: set again in case another require cleared it
  process.env.DISABLE_SYSTEM_FONTS_LOAD = '1'
  ensureAnimationFrame()

  const inputPath = asPathString(opts.inputPath)
  const outputPath = asPathString(opts.outputPath)
  const tempDir = asPathString(opts.tempDir)
  if (!inputPath || !outputPath || !tempDir) {
    throw new Error('strongCompress: 缺少路径参数')
  }
  if (!fs.existsSync(inputPath)) {
    throw new Error('输入文件不存在: ' + path.basename(inputPath))
  }

  const log = opts.log || (() => {})
  const { dpi, jpegQuality, grayscale } = mapQualityToRaster(opts.quality)
  log('INFO', 'strongCompress start', {
    dpi,
    jpegQuality,
    grayscale,
    disableSystemFonts: process.env.DISABLE_SYSTEM_FONTS_LOAD,
  })

  const scale = dpi / 72
  let pdfjs
  let buildParams
  try {
    ;({ pdfjs, buildParams } = await loadPdfjsForRender())
  } catch (e) {
    throw new Error('加载 PDF 引擎失败: ' + (e && e.message ? e.message : String(e)))
  }

  const data = new Uint8Array(fs.readFileSync(inputPath))
  const params = buildParams(data)
  const canvasFactory = createNodeCanvasFactory()
  params.canvasFactory = canvasFactory

  let pdf
  try {
    pdf = await pdfjs.getDocument(params).promise
  } catch (e) {
    throw new Error('打开 PDF 失败: ' + (e && e.message ? e.message : String(e)))
  }

  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  const imagePaths = []
  const pageSizes = []

  try {
    const n = Math.min(pdf.numPages, MAX_PAGES)
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i)
      const unscaled = page.getViewport({ scale: 1 })
      const widthPt = Number(unscaled.width) || 612
      const heightPt = Number(unscaled.height) || 792
      pageSizes.push({ widthPt, heightPt })

      let widthPx = Math.max(1, Math.round(widthPt * scale))
      let heightPx = Math.max(1, Math.round(heightPt * scale))
      const long = Math.max(widthPx, heightPx)
      if (long > STRONG_MAX_LONG_EDGE_PX) {
        const factor = STRONG_MAX_LONG_EDGE_PX / long
        widthPx = Math.max(1, Math.round(widthPx * factor))
        heightPx = Math.max(1, Math.round(heightPx * factor))
      }

      const w = widthPx
      const h = heightPx
      const canvasAndContext = canvasFactory.create(w, h)
      try {
        const ctx = canvasAndContext.context
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        const matched = page.getViewport({ scale: w / Math.max(widthPt, 1) })
        await page.render({
          canvasContext: ctx,
          viewport: matched,
          canvas: canvasAndContext.canvas,
        }).promise

        if (grayscale) {
          const imageData = ctx.getImageData(0, 0, w, h)
          const d = imageData.data
          for (let p = 0; p < d.length; p += 4) {
            const y = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114 + 0.5) | 0
            d[p] = y
            d[p + 1] = y
            d[p + 2] = y
          }
          ctx.putImageData(imageData, 0, 0)
        }

        const jpeg = canvasToJpeg(canvasAndContext.canvas, jpegQuality)
        const outImg = path.join(tempDir, 'page_' + i + '.jpg')
        fs.writeFileSync(outImg, jpeg)
        imagePaths.push(outImg)
      } finally {
        canvasFactory.destroy(canvasAndContext)
      }
    }
  } finally {
    try {
      await pdf.destroy()
    } catch {}
  }

  if (!imagePaths.length) throw new Error('未能渲染任何页面')

  await createPdfFromImages(imagePaths, outputPath, { pageSizes })

  for (const p of imagePaths) {
    try {
      fs.unlinkSync(p)
    } catch {}
  }

  log('INFO', 'strongCompress done', { pages: imagePaths.length })
  return outputPath
}

module.exports = {
  mapQualityToRaster,
  strongCompressPdf,
  canvasToJpeg,
  asPathString,
}
