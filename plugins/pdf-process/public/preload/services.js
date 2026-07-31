// MUST be first: @napi-rs/canvas auto-loads system fonts on require and throws
// "Value is non of these types String, Path" in some Electron/asar hosts.
process.env.DISABLE_SYSTEM_FONTS_LOAD = '1'

const fs = require('node:fs')
const path = require('node:path')
const { PDFDocument } = require('pdf-lib')
const {
  assertSafeOutputPath,
  assertSafeInputFile,
  safePathLabel,
} = require('./path-guard')
const pdfcpu = require('./lib/pdfcpu-runner')
const { createPdfFromImages: buildPdfFromImages } = require('./lib/create-pdf-from-images')
const { strongCompressPdf } = require('./lib/strong-compress')
const settingsStore = require('./lib/settings-store')
const { resolveTaskCoords } = require('./lib/task-paths')
const {
  hexToRgb01,
  rotatedTextBounds,
  positionToXY,
  tileSteps,
} = require('./lib/watermark-layout')

function getDownloadsRoot() {
  return window.ztools.getPath('downloads')
}

function getLogPath() {
  try {
    const base =
      (window.ztools &&
        window.ztools.getPath &&
        (window.ztools.getPath('userData') || window.ztools.getPath('downloads'))) ||
      null
    if (base) return path.join(base, 'pdf-process.log')
  } catch {}
  try {
    return path.join(require('node:os').tmpdir(), 'pdf-process.log')
  } catch {
    return path.join(process.cwd(), 'pdf-process.log')
  }
}

const LOG_PATH = getLogPath()

function log(level, msg, data) {
  const ts = new Date().toISOString()
  let payload = data
  if (typeof data === 'string' && (data.includes('\\') || data.includes('/'))) {
    payload = safePathLabel(data)
  }
  const line =
    '[' +
    ts +
    '] [' +
    level +
    '] ' +
    msg +
    (payload !== undefined ? ' ' + JSON.stringify(payload) : '') +
    '\n'
  try {
    console.log(line.trim())
  } catch {}
  try {
    fs.appendFileSync(LOG_PATH, line, { encoding: 'utf-8' })
  } catch {}
}

pdfcpu.setDeps({ log, safePathLabel })

const { callPdfcpu, cancelCurrent } = pdfcpu

// Keep names for static source tests / asar helpers (implementation in lib/pdfcpu-runner)
function resolveNativePath(filePath) {
  return pdfcpu.resolveNativePath(filePath)
}
function isInsideAsar(filePath) {
  return pdfcpu.isInsideAsar(filePath)
}
function getPdfcpuPath() {
  return pdfcpu.getPdfcpuPath()
}
function getPdfcpuCacheDir() {
  return pdfcpu.getPdfcpuCacheDir()
}

log('INFO', 'services.js loaded', {
  pdfcpu: safePathLabel(getPdfcpuPath()),
  logfile: safePathLabel(LOG_PATH),
})

function ensuredDir(dir) {
  if (!fs.existsSync(dir)) {
    log('INFO', 'mkdir', safePathLabel(dir))
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function outputDir(feature) {
  const name = String(feature || 'out').replace(/[^a-zA-Z0-9_-]/g, '') || 'out'
  return ensuredDir(path.join(getDownloadsRoot(), 'pdf-' + name))
}

function safeOut(filePath, label) {
  return assertSafeOutputPath(filePath, getDownloadsRoot(), label)
}

function safeIn(filePath) {
  return assertSafeInputFile(filePath, fs)
}

function listFiles(dir, exts) {
  if (!fs.existsSync(dir)) {
    log('WARN', 'listFiles: dir not found', safePathLabel(dir))
    return []
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)))
    .map((f) => path.join(dir, f))
    .sort()
  log('INFO', 'listFiles', { dir: safePathLabel(dir), count: files.length })
  return files
}

// CJK Unicode ranges for detecting Chinese/Japanese/Korean characters
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/

// Maps Windows font names to pdfcpu font names (as shown by "pdfcpu fonts list")
const PDFCPU_FONT_MAP = {
  'Microsoft YaHei': 'MicrosoftYaHei',
  'SimSun': 'SimSun',
  'SimHei': 'SimHei',
  'KaiTi': 'KaiTi',
  'FangSong': 'FangSong',
}

/**
 * Selects an appropriate font for the watermark text.
 * Uses a CJK-capable font when the text contains Chinese/Japanese/Korean characters,
 * otherwise falls back to Helvetica.
 */
function selectFontForText(text) {
  if (CJK_REGEX.test(text)) {
    const cjkFonts = ['Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'FangSong']
    const available = findAvailableCjkFont(cjkFonts)
    if (available) {
      const pdfcpuFont = PDFCPU_FONT_MAP[available] || available
      log('INFO', 'selectFontForText: CJK font selected', { font: pdfcpuFont, windowsFont: available, text: text.slice(0, 20) })
      return { windowsName: available, pdfcpuName: pdfcpuFont }
    }
    log('WARN', 'selectFontForText: no CJK font found, falling back to Helvetica (may fail for CJK text)')
  }
  return { windowsName: null, pdfcpuName: 'Helvetica' }
}

/**
 * Checks common font directories for an available CJK font.
 * Returns the font name if found, or null if none available.
 */
function findAvailableCjkFont(fontNames) {
  const fontDirs = [
    path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts'),
  ]
  const fontFiles = new Map()
  for (const dir of fontDirs) {
    if (!fs.existsSync(dir)) continue
    try {
      for (const f of fs.readdirSync(dir)) {
        const lower = f.toLowerCase()
        if (lower.endsWith('.ttf') || lower.endsWith('.ttc') || lower.endsWith('.otf')) {
          fontFiles.set(lower, f)
        }
      }
    } catch {}
  }
  // Map common font names to their file patterns
  const fontFilePatterns = {
    'Microsoft YaHei': ['msyh.ttc', 'msyhbd.ttc', 'microsoft yahei'],
    'SimSun': ['simsun.ttc', 'nsimsun.ttc', 'simsun'],
    'SimHei': ['simhei.ttf', 'simhei'],
    'KaiTi': ['simkai.ttf', 'kaiti'],
    'FangSong': ['simfang.ttf', 'fangsong'],
    'PingFang SC': ['pingfang', 'pingfangsc'],
    'Hiragino Sans GB': ['hiragino', 'hira'],
  }
  for (const name of fontNames) {
    const patterns = fontFilePatterns[name] || [name.toLowerCase()]
    for (const [lower, original] of fontFiles) {
      if (patterns.some(p => lower.includes(p))) {
        return name
      }
    }
  }
  return null
}

let pdfcpuFontsCache = null

function getPdfcpuFonts() {
  if (pdfcpuFontsCache) return pdfcpuFontsCache
  pdfcpuFontsCache = new Map()
  try {
    const { execFileSync } = require('node:child_process')
    const output = execFileSync(getPdfcpuPath(), ['fonts', 'list'], { encoding: 'utf-8', timeout: 10000 })
    const regex = /^(\S+)\s+\((\d+)\s+glyphs\)/gm
    let match
    while ((match = regex.exec(output)) !== null) {
      pdfcpuFontsCache.set(match[1], parseInt(match[2], 10))
    }
  } catch (e) {
    log('WARN', 'getPdfcpuFonts: failed to list fonts', e.message)
  }
  return pdfcpuFontsCache
}

function clearPdfcpuFontCache() {
  pdfcpuFontsCache = null
}

function findFontFilePath(fontName) {
  const fontDirs = [
    path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts'),
  ]
  const fontFilePatterns = {
    'Microsoft YaHei': ['msyh.ttc', 'msyhbd.ttc'],
    'SimSun': ['simsun.ttc', 'nsimsun.ttc'],
    'SimHei': ['simhei.ttf'],
    'KaiTi': ['simkai.ttf'],
    'FangSong': ['simfang.ttf'],
  }
  const patterns = fontFilePatterns[fontName] || [fontName.toLowerCase()]
  for (const dir of fontDirs) {
    if (!fs.existsSync(dir)) continue
    try {
      for (const f of fs.readdirSync(dir)) {
        const lower = f.toLowerCase()
        if (lower.endsWith('.ttf') || lower.endsWith('.ttc') || lower.endsWith('.otf')) {
          if (patterns.some(p => lower === p || lower.startsWith(p.replace(/\.(ttf|ttc|otf)/, '')))) {
            return path.join(dir, f)
          }
        }
      }
    } catch {}
  }
  return null
}

function ensurePdfcpuFont(windowsFontName, pdfcpuFontName) {
  const fonts = getPdfcpuFonts()
  const glyphCount = fonts.get(pdfcpuFontName) || 0
  if (glyphCount > 1000) return
  log('INFO', 'ensurePdfcpuFont: font needs installation', { font: pdfcpuFontName, currentGlyphs: glyphCount })
  const fontFile = findFontFilePath(windowsFontName)
  if (!fontFile) {
    log('WARN', 'ensurePdfcpuFont: font file not found in Windows Fonts', { windowsFontName })
    return
  }
  try {
    const { execFileSync } = require('node:child_process')
    execFileSync(getPdfcpuPath(), ['fonts', 'install', fontFile], { encoding: 'utf-8', timeout: 60000 })
    clearPdfcpuFontCache()
    log('INFO', 'ensurePdfcpuFont: font installed successfully', { font: pdfcpuFontName, file: fontFile })
  } catch (e) {
    log('ERROR', 'ensurePdfcpuFont: failed to install font', { font: pdfcpuFontName, error: e.message })
  }
}


function loadCjkFontBytes() {
  const winDir = process.env.WINDIR || 'C:\\Windows'
  const candidates = [
    path.join(winDir, 'Fonts', 'simhei.ttf'),
    path.join(winDir, 'Fonts', 'simfang.ttf'),
    path.join(winDir, 'Fonts', 'simkai.ttf'),
    path.join(winDir, 'Fonts', 'msyh.ttf'),
    path.join(winDir, 'Fonts', 'msyhbd.ttf'),
    path.join(winDir, 'Fonts', 'msyhl.ttf'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p)
    } catch {}
  }
  return null
}

async function addWatermarkWithPdfLib(inputPath, outputPath, opts) {
  const { rgb, degrees, StandardFonts } = require('pdf-lib')
  let fontkit
  try { fontkit = require('@pdf-lib/fontkit') } catch (e) {
    throw new Error('fontkit not available: ' + (e && e.message))
  }
  const bytes = fs.readFileSync(inputPath)
  // Respect PDF encryption; do not silently bypass passwords.
  const pdfDoc = await PDFDocument.load(bytes)
  pdfDoc.registerFontkit(fontkit)

  let font
  const fontBytes = loadCjkFontBytes()
  if (fontBytes) {
    font = await pdfDoc.embedFont(fontBytes, { subset: true })
  } else {
    const hasCjk = /[\u4e00-\u9fff]/.test(opts.text || '')
    if (hasCjk) throw new Error('No TTF CJK font available for pdf-lib watermark')
    font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  }

  const color = hexToRgb01(opts.color)
  const opacity = Math.min(1, Math.max(0.05, Number(opts.opacity) || 0.3))
  const fontSize = Math.max(8, Number(opts.points) || 20)
  const rotation = Number(opts.rotation) || 0
  const margin = Number(opts.margin) || 20
  const density = opts.density != null ? Number(opts.density) : 3
  const text = String(opts.text || 'Watermark')
  const textWidth = font.widthOfTextAtSize(text, fontSize)
  const textHeight = font.heightAtSize(fontSize)
  const rotBounds = rotatedTextBounds(textWidth, textHeight, rotation)

  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize()
    if (opts.tile) {
      const { stepX, stepY } = tileSteps(textWidth, textHeight, density)
      // start so first stamp's rotated box sits inside margin
      const startX = margin - rotBounds.minX
      const startY = margin - rotBounds.minY
      const endX = width - margin - rotBounds.maxX
      const endY = height - margin - rotBounds.maxY
      for (let y = startY; y <= endY + 0.5; y += stepY) {
        for (let x = startX; x <= endX + 0.5; x += stepX) {
          page.drawText(text, {
            x,
            y,
            size: fontSize,
            font,
            color: rgb(color.r, color.g, color.b),
            opacity,
            rotate: degrees(rotation),
          })
        }
      }
    } else {
      const xy = positionToXY(
        opts.position || 'mc',
        width,
        height,
        textWidth,
        textHeight,
        margin,
        rotation,
      )
      page.drawText(text, {
        x: xy.x,
        y: xy.y,
        size: fontSize,
        font,
        color: rgb(color.r, color.g, color.b),
        opacity,
        rotate: degrees(rotation),
      })
    }
  }

  const out = await pdfDoc.save({ useObjectStreams: true })
  fs.writeFileSync(outputPath, out)
  return outputPath
}
window.services = {
  cancelCurrent,

  deleteFile(filePath) {
    try {
      const resolved = safeOut(filePath, '删除路径')
      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved)
        log('INFO', 'deleteFile', safePathLabel(resolved))
        return true
      }
    } catch (e) {
      log('WARN', 'deleteFile failed', e && e.message)
    }
    return false
  },

  writeImageFile(base64Url, outputPath) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) {
      log('WARN', 'writeImageFile: invalid base64')
      return
    }
    let filePath
    if (outputPath) {
      filePath = safeOut(outputPath, '图片输出路径')
      ensuredDir(path.dirname(filePath))
    } else {
      const dir = outputDir('images')
      filePath = path.join(dir, Date.now().toString() + '.' + matchs[1])
    }
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    log('INFO', 'writeImageFile', safePathLabel(filePath))
    return filePath
  },

  async createPdfFromImages(imagePaths, outputPath, options = {}) {
    const out = safeOut(outputPath, 'PDF 输出路径')
    log('INFO', 'createPdfFromImages', { count: imagePaths.length, out: safePathLabel(out) })
    ensuredDir(path.dirname(out))
    const safeImages = imagePaths.map((p) => safeOut(p, '图片输入路径'))
    await buildPdfFromImages(safeImages, out, options)
    return out
  },

  async compressPdf(inputPath, outputPath, options = {}) {
    const input = safeIn(inputPath)
    const out = safeOut(outputPath, '压缩输出路径')
    ensuredDir(path.dirname(out))
    const mode = options && options.mode === 'strong' ? 'strong' : 'optimize'
    log('INFO', 'compressPdf', {
      input: safePathLabel(input),
      output: safePathLabel(out),
      mode,
    })

    if (mode === 'strong') {
      const tempDir = path.join(path.dirname(out), '.strong-tmp-' + Date.now())
      try {
        await strongCompressPdf({
          inputPath: input,
          outputPath: out,
          quality: options.quality,
          tempDir,
          log,
        })
      } finally {
        try {
          if (fs.existsSync(tempDir)) {
            for (const f of fs.readdirSync(tempDir)) {
              try {
                fs.unlinkSync(path.join(tempDir, f))
              } catch {}
            }
            fs.rmdirSync(tempDir)
          }
        } catch {}
      }
      return out
    }

    await callPdfcpu(['optimize', input, out])
    log('INFO', 'compressPdf done', safePathLabel(out))
    return out
  },

  async mergePdfs(inputPaths, outputPath) {
    const inputs = inputPaths.map((p) => safeIn(p))
    const out = safeOut(outputPath, '合并输出路径')
    ensuredDir(path.dirname(out))
    await callPdfcpu(['merge', out, ...inputs])
    return out
  },

  async splitPdf(inputPath, outputDirPath, options) {
    const input = safeIn(inputPath)
    const outDir = safeOut(outputDirPath, '拆分输出目录')
    ensuredDir(outDir)

    if (typeof options === 'string' && options.trim()) {
      const pagesSpec = options.trim()
      if (!/^[0-9,\-\s]+$/.test(pagesSpec)) throw new Error('页码范围格式无效')
      await callPdfcpu(['extract', '-m', 'page', '-p', pagesSpec, input, outDir])
      return listFiles(outDir, ['.pdf'])
    }

    const opts = options && typeof options === 'object' ? options : {}
    const pageRanges = Array.isArray(opts.pageRanges) ? opts.pageRanges : null
    const beforePages = Array.isArray(opts.beforePages)
      ? opts.beforePages.map((n) => Math.floor(Number(n))).filter((n) => n >= 2)
      : null
    const span = opts.span != null ? Math.max(1, Math.floor(Number(opts.span) || 1)) : null
    const mergeRanges = opts.mergeRanges !== false

    if (pageRanges && pageRanges.length > 0) {
      const base = path.basename(input, path.extname(input)) || 'split'
      const normalized = []
      for (const pair of pageRanges) {
        const a = Math.floor(Number(pair[0]))
        const b = Math.floor(Number(pair[1]))
        if (a >= 1 && b >= a) normalized.push([a, b])
      }
      if (!normalized.length) throw new Error('没有有效的页码范围')

      if (mergeRanges || normalized.length === 1) {
        const pagesSpec = normalized
          .map(([a, b]) => (a === b ? String(a) : a + '-' + b))
          .join(',')
        const label =
          normalized.length === 1
            ? normalized[0][0] === normalized[0][1]
              ? String(normalized[0][0])
              : normalized[0][0] + '-' + normalized[0][1]
            : 'extract'
        const outFile = path.join(outDir, base + '_' + label + '.pdf')
        await callPdfcpu(['collect', '-p', pagesSpec, input, outFile])
        return [outFile]
      }

      const outs = []
      for (const [a, b] of normalized) {
        const label = a === b ? String(a) : a + '-' + b
        const outFile = path.join(outDir, base + '_' + label + '.pdf')
        await callPdfcpu(['collect', '-p', a + '-' + b, input, outFile])
        outs.push(outFile)
      }
      return outs
    }

    if (beforePages && beforePages.length > 0) {
      const unique = Array.from(new Set(beforePages)).sort((a, b) => a - b)
      await callPdfcpu(['split', '-m', 'page', input, outDir, ...unique.map(String)])
    } else if (span != null) {
      await callPdfcpu(['split', '-m', 'span', input, outDir, String(span)])
    } else {
      await callPdfcpu(['split', '-m', 'span', input, outDir, '1'])
    }
    return listFiles(outDir, ['.pdf'])
  },

  async addWatermark(inputPath, outputPath, watermark) {
    const input = safeIn(inputPath)
    const out = safeOut(outputPath, '水印输出路径')
    ensuredDir(path.dirname(out))
    const text = (watermark && watermark.text) || 'Watermark'
    const opacity = watermark && watermark.opacity != null ? Number(watermark.opacity) : 0.3
    const points = watermark && watermark.points != null ? Number(watermark.points) : 36
    const rotation = watermark && watermark.rotation != null ? Number(watermark.rotation) : 0
    const margin = watermark && watermark.margin != null ? Number(watermark.margin) : 20
    const tile = !!(watermark && watermark.tile)
    const position = (watermark && watermark.position) || 'mc'
    const color = (watermark && watermark.color) || '#808080'
    const density = watermark && watermark.density != null ? Number(watermark.density) : 3

    try {
      await addWatermarkWithPdfLib(input, out, {
        text,
        opacity,
        points,
        rotation,
        margin,
        tile,
        position,
        color,
        density,
      })
      log('INFO', 'addWatermark done via pdf-lib', { output: safePathLabel(out) })
      return out
    } catch (e) {
      log('WARN', 'pdf-lib watermark failed, fallback pdfcpu', e && e.message)
    }

    const font = selectFontForText(text)
    if (font.windowsName) ensurePdfcpuFont(font.windowsName, font.pdfcpuName)
    const posMap = {
      tl: 'tl',
      tc: 'tc',
      tr: 'tr',
      ml: 'l',
      mc: 'c',
      mr: 'r',
      bl: 'bl',
      bc: 'bc',
      br: 'br',
      l: 'l',
      c: 'c',
      r: 'r',
    }
    const pos = posMap[position] || 'c'
    const desc = [
      'fontname:' + font.pdfcpuName,
      'points:' + points,
      'opacity:' + opacity,
      'rot:' + rotation,
      'fillcol:' + color,
      'pos:' + (tile ? 'c' : pos),
    ].join(', ')
    try {
      await callPdfcpu(['stamp', 'add', '-mode', 'text', desc, text, input, out])
    } catch (e1) {
      await callPdfcpu(['watermark', 'add', '-mode', 'text', desc, text, input, out])
    }
    return out
  },

  async convertPdf(inputPath, outputPath, format) {
    const input = safeIn(inputPath)
    const out = safeOut(outputPath, '转换输出路径')
    if (!['word', 'ppt', 'excel'].includes(format)) throw new Error('不支持的转换格式: ' + format)
    ensuredDir(path.dirname(out))
    let convertPdfLocal
    try {
      ;({ convertPdfLocal } = require('./convert/convert-local'))
    } catch (e) {
      if (e && e.code === 'MODULE_NOT_FOUND') {
        throw new Error('本地转换依赖未安装，请在 public/preload 执行 npm install')
      }
      throw e
    }
    return convertPdfLocal({ inputPath: input, outputPath: out, format })
  },

  resolveTaskPath(coords) {
    const r = resolveTaskCoords(getDownloadsRoot(), coords)
    if (r.filePath) {
      ensuredDir(path.dirname(r.filePath))
      return r.filePath
    }
    ensuredDir(r.dir)
    return r.dir
  },

  /** Stat a readable path for UI (size only). Inputs may be user-selected anywhere. */
  statFile(filePath) {
    try {
      if (!filePath || typeof filePath !== 'string') return null
      const resolved = path.resolve(filePath)
      const st = fs.statSync(resolved)
      if (!st.isFile()) return null
      return { size: st.size, mtimeMs: st.mtimeMs }
    } catch {
      return null
    }
  },

  /**
   * Read an existing user-selected file as base64 (for renderer-side strong compress
   * when only a path is available from the system open dialog).
   */
  readFileBase64(filePath) {
    const input = safeIn(filePath)
    const buf = fs.readFileSync(input)
    return buf.toString('base64')
  },

  /**
   * Page count for a PDF path (path-only files without browser File handle).
   * Uses pdf-lib (no canvas) so it works under asar without worker issues.
   */
  async getPdfPageCount(filePath) {
    try {
      const input = safeIn(filePath)
      const bytes = fs.readFileSync(input)
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
      return pdf.getPageCount()
    } catch (e) {
      log('WARN', 'getPdfPageCount failed', e && e.message)
      return 0
    }
  },

  async getSettings() {
    return settingsStore.loadSettings(window.ztools.dbStorage)
  },

  async saveSettings(settings) {
    settingsStore.saveSettings(window.ztools.dbStorage, settings)
  },
}
