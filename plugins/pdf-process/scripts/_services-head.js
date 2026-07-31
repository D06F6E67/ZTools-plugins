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

const { callPdfcpu, cancelCurrent, getPdfcpuPath } = pdfcpu

// Keep names for static source tests / asar helpers
function resolveNativePath(filePath) {
  return pdfcpu.resolveNativePath(filePath)
}
function isInsideAsar(filePath) {
  return pdfcpu.isInsideAsar(filePath)
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
