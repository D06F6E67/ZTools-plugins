const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

let currentChild = null
let log = () => {}
let safePathLabel = (p) => p

function setDeps(deps) {
  if (deps.log) log = deps.log
  if (deps.safePathLabel) safePathLabel = deps.safePathLabel
}

function isInsideAsar(filePath) {
  if (!filePath) return false
  if (/\.asar\.unpacked([\\/]|$)/.test(filePath)) return false
  return filePath.includes('.asar' + path.sep) || /\.asar[\\/]/.test(filePath)
}

/** Rewrite app.asar\\foo -> app.asar.unpacked\\foo for native binaries. */
function resolveNativePath(filePath) {
  if (!isInsideAsar(filePath)) return filePath
  return filePath.replace(/\.asar([\\/])/, '.asar.unpacked$1')
}

function getPdfcpuCacheDir() {
  try {
    const base =
      window.ztools && window.ztools.getPath
        ? window.ztools.getPath('userData') || window.ztools.getPath('downloads')
        : null
    if (base) return path.join(base, 'pdf-process-bin')
  } catch {}
  try {
    return path.join(require('node:os').tmpdir(), 'pdf-process-bin')
  } catch {
    return path.join(process.cwd(), 'pdf-process-bin')
  }
}

/**
 * Resolve a spawn-able pdfcpu.exe path.
 * Electron cannot spawn binaries from inside .asar; prefer .asar.unpacked,
 * then extract a copy under userData/pdf-process-bin.
 * This file lives in public/preload/lib → bin is public/bin.
 */
function getPdfcpuPath() {
  const primary = path.join(__dirname, '..', '..', 'bin', 'pdfcpu.exe')
  const unpacked = resolveNativePath(primary)
  const cached = path.join(
    getPdfcpuCacheDir(),
    process.platform === 'win32' ? 'pdfcpu.exe' : 'pdfcpu',
  )
  const candidates = [unpacked, cached]
  if (unpacked !== primary) candidates.push(primary)

  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c) && !isInsideAsar(c)) return c
    } catch {}
  }

  for (const src of [primary, unpacked]) {
    try {
      if (!src || !fs.existsSync(src)) continue
      const dir = path.dirname(cached)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(src, cached)
      try {
        fs.chmodSync(cached, 0o755)
      } catch {}
      if (fs.existsSync(cached) && !isInsideAsar(cached)) {
        log('INFO', 'pdfcpu extracted to cache', {
          from: safePathLabel(src),
          to: safePathLabel(cached),
        })
        return cached
      }
    } catch (e) {
      try {
        log('WARN', 'pdfcpu extract failed', { error: e && e.message })
      } catch {}
    }
  }

  return unpacked
}

function cancelCurrent() {
  if (currentChild) {
    log('INFO', 'cancelling child process', { pid: currentChild.pid })
    try {
      currentChild.kill()
    } catch (e) {
      log('WARN', 'kill failed', e.message)
    }
    currentChild = null
  }
}

function callPdfcpu(args) {
  const exe = getPdfcpuPath()
  log('INFO', 'pdfcpu spawn', {
    exe: safePathLabel(exe),
    args,
    insideAsar: isInsideAsar(exe),
  })
  return new Promise((resolve, reject) => {
    if (!exe || !fs.existsSync(exe) || isInsideAsar(exe)) {
      const err = new Error('pdfcpu binary not found or not spawnable: ' + exe)
      log('ERROR', 'pdfcpu missing', { path: safePathLabel(exe) })
      return reject(err)
    }
    const child = spawn(exe, ['--force', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    currentChild = child
    log('INFO', 'pdfcpu started', { pid: child.pid })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('close', (code) => {
      currentChild = null
      if (stderr) log('WARN', 'pdfcpu stderr', stderr.trim())
      log('INFO', 'pdfcpu exit', { code, outLen: stdout.length })
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || stdout.trim() || 'exit code ' + code))
    })
    child.on('error', (err) => {
      currentChild = null
      log('ERROR', 'pdfcpu error', err.message)
      reject(err)
    })
  })
}

module.exports = {
  setDeps,
  isInsideAsar,
  resolveNativePath,
  getPdfcpuCacheDir,
  getPdfcpuPath,
  callPdfcpu,
  cancelCurrent,
}
